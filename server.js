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
const fileType = require('file-type');

const app = express();

const regexUA = RegExp('^[a-zA-Z0-9-_ \t\\\/\.;:]{0,1024}$');

const languages = (() => {
  const contents = fs.readFileSync('languages.json');
  return JSON.parse(contents.toString('utf8').toLowerCase());
})();

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

const validateHeaders = (headers) => {

  // validate the language
  if (headers['accept-language'] !== undefined) {
    const lang_header = headers['accept-language'].toLowerCase();

    // if the passed language contains anything different from two (eg. pt)
    // or five (eg. pt-br) chars, we deny
    if (lang_header.length !== 2 && lang_header.length !== 5) {
      return 'accept-language';
    }

    // if the passed language contains five chars, (eg. pt-br)
    // we try to match the exact key in the json, and if we find, we accept
    if (lang_header.length === 5 && languages[lang_header] === undefined) {
      return 'accept-language';
    }

    // if the passed language contains two chars, we try to find a correspondent
    // substring in the json's key and if it matches, we accept
    if (lang_header.length === 2) {
      let match_lang = false;
      for (const lang in languages) {
        if (lang.substring(0,2) === lang_header) {
          match_lang = true;
          break;
        }
      }
      if (!match_lang) {
        return 'accept-language';
      }
    }
  }

  // validate storesample
  if ((headers['store-sample'] !== undefined) &&  ((headers['store-sample'] !== '1') && (headers['store-sample'] !== '0'))) {
    return 'store-sample';
  }

  // validate storetranscription
  if ((headers['store-transcription'] !== undefined) &&  ((headers['store-transcription'] !== '1') && (headers['store-transcription'] !== '0'))) {
    return 'store-transcription';
  }

  // validate useragent
  if ((headers['user-agent'] !== undefined) && (!regexUA.test(headers['user-agent']))) {
    return 'user-agent';
  }

  // validate producttag
  if ((headers['product-tag'] !== undefined) && (!regexUA.test(headers['product-tag']))) {
    return 'product-tag';
  }

  return null;
};

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
  }, function (asrErr, asrRes) {
    // and send back the results to the client
    if (asrErr) {
      res.status(500);
      return res.end();
    } else if (asrRes.statusCode === 200) {
      res.status(200);
      return res.end();
    } else {
      res.status(500);
      return res.end();
    }
  });
});

app.get('/', (req, res) => {
  res.json({message: 'Okay'});
});

app.post('*', function (req, res, next) {

  let decodeArgs;

  // then we convert it from opus to raw pcm
  const jailArgs = [
    'firejail',
    '--profile=opusdec.profile',
    '--debug',
    '--force'
  ];

  const header_validation = validateHeaders(req.headers);

  if (header_validation !== null) {
    // convert the headers to hex to log it
    const headers = JSON.stringify(req.headers);
    const hex = [];
    for (let n = 0, l = headers.length; n < l; n ++) {
      const hexval = Number(headers.charCodeAt(n)).toString(16);
      hex.push(hexval);
    }

    mozlog.info('request.header.error', {
      request_id: res.locals.request_id,
      error: hex.join('')
    });
    return res.status(400).json({message: 'Bad header:' + header_validation});
  }

  if (fileType(req.body) === null) {
    return res.status(400).json({message: 'Body should be an Opus or Webm audio file'});
  } else if ((fileType(req.body).ext === 'webm') || (fileType(req.body).ext === '3gp')) {
    decodeArgs = [
      'ffmpeg', '-i', '-', '-c:v', 'libvpx', '-f' , 's16le', '-ar',
      '16000', '-acodec',  'pcm_s16le', '-'
    ];
  } else if (fileType(req.body).ext === 'opus') {
    decodeArgs = [
      'opusdec',
      '--rate',
      '16000',
      '-',
      '-'
    ];
  } else {
    return res.status(400).json({message: 'Body should be an Opus or Webm audio file'});
  }

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

  const key_uuid = uuid();
  const key_base = key_uuid.slice(0,2) + '/' + key_uuid;

  // assemble and store the metadata file
  const metadata = {'language': req.headers['accept-language'],
    'storesample': req.headers['store-sample'] !== null ? req.headers['store-sample'] : '1',
    'storetranscription': req.headers['store-transcription'] !== null ? req.headers['store-transcription'] : '1',
    'useragent': req.headers['user-agent'],
    'producttag': req.headers['product-tag']};

  if (config.s3_bucket) {
    const metadata_upload_params = {
      Body: metadata,
      Bucket: config.s3_bucket,
      ContentType: 'application/json',
      Key: key_base + '/metadata.json'
    };

    const s3_request_start = Date.now();

    mozlog.info('request.s3.audio.start', {
      request_id: res.locals.request_id,
      key: key_base + '/metadata.json'
    });

    S3.putObject(metadata_upload_params, (s3_error) => {
      if (s3_error) {
        mozlog.info('request.s3.audio.error', {
          request_id: res.locals.request_id,
          key: key_base + '/metadata.json',
          status: s3_error.statusCode,
          body: req.body.length,
          time: Date.now() - s3_request_start
        });
        return next(s3_error);
      }

      mozlog.info('request.s3.audio.finish', {
        request_id: res.locals.request_id,
        key: key_base + '/metadata.json',
        status: 200,
        body: req.body.length,
        time: Date.now() - s3_request_start
      });
    });
  }

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

  if (config.s3_bucket && metadata.storesample === 1) {
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
    headers: {'Content-Type': 'application/octet-stream', 'Accept-Language': metadata.language},
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

    if (config.s3_bucket && metadata.storetranscription === 1) {
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
