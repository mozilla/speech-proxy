
build:
	docker build -t speech-proxy:build .

run:
	docker run \
		-p 9001:9001 \
		--env ASR_URL=https://speaktome-kaldi.stage.mozaws.net/asr \
		--env DISABLE_DECODE_JAIL=1 \
		speech-proxy:build

test:
	curl -i -X POST http://localhost:9001/ -H 'Content-Type: audio/opus' -H 'Accept-Language: en-us' -H 'Store-Sample: 1' -H 'Store-Transcription: 1' -H 'Product-Tag: shell-curl' --data-binary @speech_orig.opus
	curl -i -X POST http://localhost:9001/ -H 'Content-Type: audio/webm' -H 'Accept-Language: en-us' -H 'Store-Sample: 1' -H 'Store-Transcription: 1' -H 'Product-Tag: shell-curl' --data-binary @webm.webm

sh:
	docker exec -it $CONTAINER_ID bash

lint:
	eslint -c .eslintrc.yml *.js

.PHONY: build run test sh lint
