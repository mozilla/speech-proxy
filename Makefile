
build:
	docker build -t app:build .

run:
	docker run \
		-p 9001:9001 \
		-v $(shell pwd):/app/ \
		--privileged \
		app:build

test:
	curl -X POST http://localhost:9001/ --data-binary @speech_orig.opus

sh:
	docker exec -it $CONTAINER_ID bash


.PHONY: build run test sh
