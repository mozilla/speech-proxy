
build:
	docker build -t app:build .

run:
	docker run \
		-p 9001:9001 \
		--env ASR_URL=https://speaktome-kaldi.stage.mozaws.net/asr \
		--env DISABLE_DECODE_JAIL=0 \
		--privileged \
		app:build

test:
	curl -i -X POST http://localhost:9001/ -H 'Content-Type: audio/opus' --data-binary @speech_orig.opus

sh:
	docker exec -it $CONTAINER_ID bash

lint:
	eslint -c .eslintrc.yml *.js

.PHONY: build run test sh lint
