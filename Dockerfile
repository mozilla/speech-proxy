FROM node:8-slim

# add a non-privileged user for installing and running
# the application
RUN groupadd --gid 10001 app && \
    useradd --uid 10001 --gid 10001 --home /app --create-home app

WORKDIR /app

COPY package.json package.json
COPY package-lock.json package-lock.json

# Install updates
RUN apt-get update && \
    apt-get install -y \
        libgmp-dev git python build-essential opus-tools

# Install node requirements
RUN su app -c "npm --loglevel warn install" && \
    npm install

# Install firejail
RUN git clone https://github.com/netblue30/firejail.git && \
    cd firejail && \
    ./configure && make && make install-strip

# cleanup firejail build-dir
RUN rm -rf /app/firejail

# clean up
RUN npm cache verify && \
    apt remove -y libgmp-dev git python build-essential && \
    apt-get autoremove -y && \
    apt-get clean

COPY . /app

RUN chown -R app:$(id -gn app) /app/.config

USER app
ENTRYPOINT ["npm"]
CMD ["start"]
