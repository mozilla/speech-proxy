FROM node:8-slim

# add a non-privileged user for installing and running
# the application
RUN groupadd --gid 10001 app && \
    useradd --uid 10001 --gid 10001 --home /app --create-home app

WORKDIR /app

# Install node requirements
COPY package.json package.json
RUN apt-get update && \
    apt-get install -y \
    	    	    libgmp-dev git python build-essential opus-tools && \
    su app -c "npm --loglevel warn install" && \
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

USER app
ENTRYPOINT ["npm"]
CMD ["start"]