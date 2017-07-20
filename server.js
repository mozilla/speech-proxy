/**
 * Created by anatal on 3/17/17.
 */

const AWS = require('aws-sdk');
const express = require('express');
const bodyParser = require('body-parser');
const cp = require('child_process');
const request = require('request');
const Joi = require('joi');
const fs = require('fs');
const uuid = require('uuid/v4');

const app = express();

const configSchema =  Joi.object({
  asr_url: Joi.string(),
  disable_jail: Joi.boolean(),
  s3_bucket: Joi.string().optional()
});

const config = {
  asr_url: process.env.ASR_URL,
  disable_jail: (process.env.DISABLE_DECODE_JAIL === '1'),
  s3_bucket: process.env.S3_BUCKET
};

Joi.assert(config, configSchema);

if (config.s3_bucket) {
  var S3 = new AWS.S3();
}

app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  // Prevent browsers mistaking user provided content as HTML
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');

  next();
});

app.use(
  bodyParser.raw({
    limit: 1024000,
    type: function () {
      return true;
    }
  })
);

app.get('/__version__', function (req, res) {
  let result = '';
  if (fs.existsSync('version.json')){
    result = fs.readFileSync('version.json', 'utf8');
  }

  res.setHeader('Content-Type', 'application/json');
  res.status(200);
  res.write(result);
  return res.end();
});

app.get('/__lbheartbeat__', function (req, res) {
  res.status(200);
  return res.end();
});

app.get('/__heartbeat__', function (req, res) {
  let opusbytes = '';
  const hbfile = 'hb.raw';
  if (fs.existsSync(hbfile)){
    opusbytes = fs.readFileSync(hbfile);
  }
  // send to the asr server
  request({
    url: config.asr_url,
    method: 'POST',
    body: opusbytes,
    headers: {'Content-Type': 'application/octet-stream'},
    qs: {'endofspeech': 'false', 'nbest': 10}
  }, function (asrErr, asrRes, asrBody) {
    // and send back the results to the client
    if (asrErr) {
      res.status(500);
      return res.end();
    }

    let jsonResults;
    try {
      jsonResults = JSON.parse(asrBody.toString('utf8'));
      for (const idx in jsonResults.data) {
        if (jsonResults.data[idx].text === 'HEART BEAT') {
          res.status(200);
          return res.end();
        }
      }
    } catch (e) {
      res.status(500);
      return res.end();
    }

    res.status(500);
    return res.end();
  });
});

app.use(function (req, res) {

  // if method is GET we return right away
  if (req.method === 'GET') {
    res.status(200);
    return res.end();
  }

  // if is not an opus file we return right away
  const isOpus = req.body[0] === 79 &&
        req.body[1] === 103 &&
        req.body[2] === 103 &&
        req.body[3] === 83 &&
        req.body[28] === 79 &&
        req.body[29] === 112 &&
        req.body[30] === 117 &&
        req.body[31] === 115 &&
        req.body[32] === 72 &&
        req.body[33] === 101 &&
        req.body[34] === 97 &&
        req.body[35] === 100;

  if (!isOpus) {
    res.status(500);
    return res.end();
  }

  // then we convert it from opus to raw pcm
  const jailArgs = [
    'firejail',
    '--profile=opusdec.profile',
    '--debug',
    '--force'
  ];
  const decodeArgs = [
    'opusdec',
    '--rate',
    '16000',
    '-',
    '-'
  ];

  let args = null;
  if (config.disable_jail) {
    args = decodeArgs;
  } else {
    args = jailArgs.concat(decodeArgs);
  }
  const opusdec = cp.spawn(args[0], args.slice(1), {stdio: ['pipe', 'pipe', 'pipe']});

  opusdec.on('error', function (err) {
    process.stderr.write('Failed to start child process:', err, '\n');
    res.status(500);
    return res.end();
  });

  opusdec.stdin.write(req.body);
  opusdec.stdin.end();

  // no-op to not fill up the buffer
  opusdec.stderr.on('data', function (data) {
    process.stderr.write(data.toString('utf8'));
  });

  opusdec.on('close', function (code) {
    if (code !== 0) {
      res.status(500);
      return res.end();
    }
  });

  const key_uuid = uuid();
  const key_base = key_uuid.slice(0,2) + '/' + key_uuid;
  if (config.s3_bucket) {
    const audio_upload_params = {
      Body: req.body,
      Bucket: config.s3_bucket,
      ContentType: 'audio/opus',
      Key: key_base + '/audio.opus'
    };

    S3.putObject(audio_upload_params, (s3_error, s3_response) => {
      if (s3_error) {
        console.log("Failed to upload audio to S3")
        console.log(s3_error);
        return;
      }

      console.log("Successfully uploaded %s", key_base + '/audio.opus');
    });
  }

  // send to the asr server
  request({
    url: config.asr_url,
    method: 'POST',
    body: opusdec.stdout,
    headers: {'Content-Type': 'application/octet-stream'},
    qs: {'endofspeech': 'false', 'nbest': 10}
  }, function (asrErr, asrRes, asrBody) {
    // and send back the results to the client
    if (asrErr) {
      res.status(502);
      return res.end();
    }
    const resBody = asrBody && asrBody.toString('utf8');

    res.setHeader('Content-Type', 'text/plain');
    res.status(200);
    res.write(resBody);

    if (config.s3_bucket) {
      const json_upload_params = {
        Body: resBody,
        Bucket: config.s3_bucket,
        ContentType: 'application/json',
        Key: key_base + '/transcript.json'
      };

      S3.putObject(json_upload_params, (s3_error, s3_response) => {
        if (s3_error) {
          console.log("Failed to upload json to S3")
          console.log(s3_error);
          return;
        }

        console.log("Successfully uploaded %s", key_base + '/transcript.json');
      });
    }

    return res.end();
  });
});

if (config.disable_jail) {
  process.stdout.write('Opus decode jail disabled.\n');
}
const port = process.env.PORT || 9001;
app.listen(port);
process.stdout.write('HTTP and BinaryJS server started on port ' + port + '\n');
