/**
 * Created by anatal on 3/17/17.
 */
const http = require('http');
// Serve client side statically
const express = require('express');
const bodyParser = require('body-parser');
const process = require('process');
const cp = require('child_process');
const request = require('request');
const Joi = require('joi');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

const ASR_URL = process.env.ASR_URL;

const configSchema =  Joi.object({
  asr_url: Joi.string(),
  disable_jail: Joi.boolean()
});

const config = {
  asr_url: ASR_URL,
  disable_jail: (process.env.DISABLE_DECODE_JAIL === '1')
};

Joi.assert(config, configSchema);

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
    url: ASR_URL,
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
    return res.end();
  });
});

if (config.disable_jail) {
  process.stdout.write('Opus decode jail disabled.\n');
}
const port = process.env.PORT || 9001;
server.listen(port);
process.stdout.write('HTTP and BinaryJS server started on port ' + port + '\n');
