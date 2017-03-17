/**
 * Created by anatal on 3/17/17.
 */
var http = require('http');
// Serve client side statically
var express = require('express');
var app = express();
var server = http.createServer(app);
var bodyParser = require('body-parser');
var fs = require('fs');

app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

var rawBodySaver = function (req, res, buf, encoding) {
    if (buf && buf.length) {
        req.rawBody = buf;
        console.log(buf.length, ' bytes written');

        // first we save the file as opus
        var id = Math.random() * Date.now() ;
        fs.writeFileSync(id + '.opus' , req.rawBody, (err) => {
            if (err) throw err;
        });

        // then we convert it from opus to raw pcm
        var resultcurl = require('child_process').spawnSync('opusdec', ['--rate', '16000', id + '.opus', id + '.raw']);

        // send to the asr server
        var resultcurl = require('child_process').spawnSync('curl', ['-H',"Content-Type: application/octet-stream","--data-binary", "@" + id + '.raw',"http://10.252.24.90/asr?endofspeech=false&nbest=10"] );

        // and send back the results to the client
        res.setHeader('Content-Type', 'text/plain');
        console.log(resultcurl.stdout.toString('utf8'))
        console.log(resultcurl.stderr.toString('utf8'))
        console.log(resultcurl.status)
        res.write(resultcurl.stdout.toString('utf8'));
        res.end();
    }
}
app.use(bodyParser.raw({ limit:1024000,  verify: rawBodySaver, type: function () {
    return true
} }));


server.listen(9001);
console.log('HTTP and BinaryJS server started on port 9001');