[![Build Status](https://travis-ci.org/mozilla/speech-proxy.svg?branch=master)](https://travis-ci.org/mozilla/speech-proxy)

This project is the server-side proxy component of the Voice Fill Test Pilot
experiment.  Roughly, it's the box labeled "speak-to-me node server" in the
diagram below.

![Rough diagram](/docs/images/servers.png)

## To build
docker build -t speech-proxy .

## To run
docker run -e ASR_URL=http://192.168.0.44/asr -e DISABLE_DECODE_JAIL=1  -p 9001:9001 speech-proxy:latest
