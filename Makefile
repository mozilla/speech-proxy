
build:
	docker build -t speech-proxy:build .

run:
	docker run \
		-p 9001:9001 \
		--env ASR_URL=https://speaktome-kaldi.stage.mozaws.net/asr \
		--env DISABLE_DECODE_JAIL=1 \
		speech-proxy:build

test:
	curl -w "@curl-format.txt" -X POST http://localhost:9001/ -H 'Content-Type: audio/opus' --data-binary @speech_orig.opus
	curl -w "@curl-format.txt" -i -X POST http://localhost:9001/ -H 'Content-Type: audio/webm' --data-binary @webm.webm

sh:
	docker exec -it $CONTAINER_ID bash

lint:
	eslint -c .eslintrc.yml *.js

.PHONY: build run test sh lint
