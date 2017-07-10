## To build
docker build -t asr-server .

## To run
docker run -e ASR_URL=http://192.168.0.44/asr -e DISABLE_DECODE_JAIL=1  -p 9001:9001 speech-proxy:latest
