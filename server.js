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
  asr_url: Joi.string()
});

Joi.assert({
  asr_url: ASR_URL
}, configSchema);

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
  let result = "";
  if (fs.existsSync("version.json")){
    result = fs.readFileSync("version.json", "utf8");
  }

  res.setHeader('Content-Type', 'application/json');
  res.status(200);
  res.write(result);
  res.end();
});

app.get('/__lbheartbeat__', function (req, res) {
  res.status(200);
  res.end();
});

app.get('/__heartbeat__', function (req, res) {
  let opusbytes = "";
  let hbfile = "hb.raw";
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
      for (idx in jsonResults.data) {
         if (jsonResults.data[idx].text === "HEART BEAT"){
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
  const opusdec = cp.spawn('firejail', [
    '--profile=opusdec.profile',
    '--debug',
    '--force',
    'opusdec',
    '--rate',
    '16000',
    '-',
    '-'
  ], {stdio: ['pipe', 'pipe', 'pipe']});

  opusdec.on('error', function (err) {
    process.stderr.write('Failed to start child process:', err, '\n');
    res.status(500);
    res.end();
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
      res.end();
    }
  });

  // send to the asr server
  request({
    url: ASR_URL,
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

const port = process.env.PORT || 9001;
server.listen(port);
process.stdout.write('HTTP and BinaryJS server started on port ' + port + '\n');
