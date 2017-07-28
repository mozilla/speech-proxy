/**
 * Created by anatal on 3/17/17.
 */

const AWS = require('aws-sdk');
const express = require('express');
const bodyParser = require('body-parser');
const cp = require('child_process');
const mozlog = require('mozlog')({
  app: 'speech-proxy'
})('server');
const request = require('request');
const Joi = require('joi');
const fs = require('fs');
const uuid = require('uuid/v4');

const app = express();

const configSchema =  Joi.object({
  asr_url: Joi.string(),
  disable_jail: Joi.boolean(),
  port: Joi.number(),
  s3_bucket: Joi.string().optional()
});

const config = {
  asr_url: process.env.ASR_URL,
  disable_jail: (process.env.DISABLE_DECODE_JAIL === '1'),
  port: process.env.PORT || 9001,
  s3_bucket: process.env.S3_BUCKET
};

mozlog.info('config', config);

Joi.assert(config, configSchema);

const S3 = new AWS.S3({
  region: process.env.AWS_DEFAULT_REGION || 'us-east-1'
});

app.use((req, res, next) => {
  const request_start = Date.now();
  res.locals.request_id = uuid();

  mozlog.info('request.start', {
    request_id: res.locals.request_id,
    remote_addr: req.ip,
    method: req.method,
    path: req.originalUrl,
    referrer: req.get('Referrer'),
    user_agent: req.get('User-Agent')
  });

  res.once('finish', () => {
    mozlog.info('request.finish', {
      request_id: res.locals.request_id,
      remote_addr: req.ip,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      body: res.get('Content-Length'),
      time: Date.now() - request_start,
      referrer: req.get('Referrer'),
      user_agent: req.get('User-Agent')
    });
  });

  next();
});

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

app.get('/__version__', function (req, res, next) {
  fs.readFile('version.json', (read_error, version) => {
    if (read_error) {
      return next(read_error);
    }

    res.json(JSON.parse(version));
  });
});

app.get('/__lbheartbeat__', function (req, res) {
  res.json({message: 'Okay'});
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

app.get('/', (req, res) => {
  res.json({message: 'Okay'});
});

app.post('*', function (req, res, next) {
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
    return res.status(400).json({message: 'Body should be an Opus audio file'});
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
  const opusdec_start = Date.now();
  mozlog.info('request.opusdec.start', {
    request_id: res.locals.request_id
  });
  const opusdec = cp.spawn(args[0], args.slice(1), {stdio: ['pipe', 'pipe', 'pipe']});

  opusdec.on('error', next);

  opusdec.stdin.write(req.body);
  opusdec.stdin.end();

  // no-op to not fill up the buffer
  const opsdec_stderr_buf = [];
  opusdec.stderr.on('data', function (data) {
    opsdec_stderr_buf.push(data);
  });

  opusdec.on('close', function (code) {
    mozlog.info('request.opusdec.finish', {
      request_id: res.locals.request_id,
      time: Date.now() - opusdec_start,
      stderr: Buffer.concat(opsdec_stderr_buf).toString('utf8')
    });
    if (code !== 0) {
      next(new Error('opusdec exited with code %d', code));
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

    const s3_request_start = Date.now();

    mozlog.info('request.s3.audio.start', {
      request_id: res.locals.request_id,
      key: key_base + '/audio.opus'
    });

    S3.putObject(audio_upload_params, (s3_error) => {
      if (s3_error) {
        mozlog.info('request.s3.audio.error', {
          request_id: res.locals.request_id,
          key: key_base + '/audio.opus',
          status: s3_error.statusCode,
          body: req.body.length,
          time: Date.now() - s3_request_start
        });
        return next(s3_error);
      }

      mozlog.info('request.s3.audio.finish', {
        request_id: res.locals.request_id,
        key: key_base + '/audio.opus',
        status: 200,
        body: req.body.length,
        time: Date.now() - s3_request_start
      });
    });
  }

  const asr_request_start = Date.now();

  mozlog.info('request.asr.start', {
    request_id: res.locals.request_id
  });

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
      mozlog.info('request.asr.error', {
        request_id: res.locals.request_id,
        time: Date.now() - asr_request_start
      });
      return next(asrErr);
    }

    const resBody = asrBody && asrBody.toString('utf8');
    try {
      res.json(JSON.parse(resBody));
    } catch (e) {
      mozlog.info('request.asr.error', {
        request_id: res.locals.request_id,
        time: Date.now() - asr_request_start
      });
      return res.status(500).json({error: 'Internal STT Server Error'});
    }

    mozlog.info('request.asr.finish', {
      request_id: res.locals.request_id,
      status: 200,
      time: Date.now() - asr_request_start
    });

    if (config.s3_bucket) {
      const json_upload_params = {
        Body: resBody,
        Bucket: config.s3_bucket,
        ContentType: 'application/json',
        Key: key_base + '/transcript.json'
      };

      const s3_request_start = Date.now();

      mozlog.info('request.s3.json.start', {
        request_id: res.locals.request_id,
        key: key_base + '/transcript.json'
      });

      S3.putObject(json_upload_params, (s3_error) => {
        if (s3_error) {
          mozlog.info('request.s3.json.error', {
            request_id: res.locals.request_id,
            key: key_base + '/transcript.json',
            status: s3_error.statusCode,
            time: Date.now() - s3_request_start
          });
          return next(s3_error);
        }

        mozlog.info('request.s3.json.finish', {
          request_id: res.locals.request_id,
          key: key_base + '/transcript.json',
          status: 200,
          time: Date.now() - s3_request_start
        });
      });
    }
  });
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  mozlog.info('request.error', {
    request_id: res.locals.request_id,
    error: err
  });

  res.status(500).json({
    message: err
  });
});

const server = app.listen(config.port);
mozlog.info('listen');

process.on('SIGINT', () => { server.close(); });
process.on('SIGTERM', () => { server.close(); });
server.once('close', () => { mozlog.info('shutdown'); });
