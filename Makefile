
build:
	docker build -t app:build .

run:
	docker run \
		-p 9001:9001 \
		-p 9009:9009 \
		--env ASR_HOST=localhost \
		--env ASR_PORT=9009 \
		--privileged \
		app:build

test:
	curl -X POST http://localhost:9001/ -H 'Content-Type: audio/opus' --data-binary @speech_orig.opus

sh:
	docker exec -it $CONTAINER_ID bash

lint:
	eslint -c .eslintrc.yml *.js

.PHONY: build run test sh lint
