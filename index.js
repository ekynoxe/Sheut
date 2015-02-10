'use strict';
var Promise = require('es6-promise').Promise;
var findup = require('findup-sync');
var gutil = require('gulp-util');
var casperPath = findup('node_modules/sheut/casper.js');
var configPath = findup('./sheut.config.js');
if (!configPath) {
    console.log('Please add a sheut.config.js file in your root.');
    process.exit(1);
}

var config = require(configPath);
var mkdirp = require('mkdirp');
var del = require('del');
var fs = require('fs');
var fse = require('fs-extra');
var child_process = require('child_process');
var spawn = child_process.spawn;
var exec = child_process.exec;
var execFile = child_process.execFile;
var resemble = require('./wrappers/resemble');
var nodeCasper = require('./wrappers/casper');
var staticServer = require('./wrappers/server');
var paths = {
    new: config.screenshots + '/new',
    different: config.screenshots + '/different',
    reference: config.screenshots + '/reference'
};
var thresholds = config.thresholds || { };

function serve(server){
    if (!server) return;
    return staticServer.start(server.dir, server.port);
}

function capture(){
    var testServer = serve(config.server);
    return nodeCasper([casperPath || './casper.js', '--configPath=' + configPath]).then(function closeServer(){
        testServer && testServer.close();
        return {message: 'Sheut: Images Captured'};
    });
}

function accept(){
    return new Promise(function(resolve, reject){
        fse.copy(paths.new, paths.reference, function(err){
            if (err) return reject(err);
            resolve({message: 'Sheut: Images Accepted as reference shots'});
        })
    });
}


function clean(){
    return new Promise(function(resolve, reject){
        del([paths.new, paths.different], function(){
            resolve({message: 'Sheut: New and Different Images removed'})
        });
    });
}

function findFiles(dir){
    return new Promise(function(resolve, reject){
        execFile('find', [ dir ], function(err, stdout, stderr) {
            resolve(stdout);
        });
    });
}

function saveDifference(file, data){
    return new Promise(function(resolve, reject){
        mkdirp(paths.different, function saveFile(){
            var base64 = data.getImageDataUrl().replace(/^data:image\/png;base64,/, "");
            fs.writeFile(file, base64, {encoding:'base64'}, function(){
                resolve()
            });
        });
    });
}

function compareAndSaveDifference(file){
    return new Promise(function(resolve, reject){
        var img1 = fs.readFileSync(file);
        var img2 = fs.readFileSync(file.replace('/reference/', '/new/'));
        var imgDiff = file.replace('/reference/', '/different/');
        var api = resemble(img2).compareTo(img1).onComplete(function(data){
            var errors = imageErrors(imgDiff, data);
            if (errors.length){
                saveDifference(imgDiff, data).then(function(){
                    var err = new gutil.PluginError('Sheut: ', errors.join('\n'), {showStack: false})
                    reject(err);
                });
            } else {
                resolve({message: 'Sheut: Images Captured'});
            }
        });
    });
}

function imageErrors(file, data){
    var errors = [];
    if (!data.isSameDimensions) {
        if (data.dimensionDifference.width !== (thresholds.width || 0)) {
            errors.push('the new image is wider/smaller: ' + data.dimensionDifference.width + 'px different');
        }
        if (data.dimensionDifference.height !== (thresholds.height || 0)) {
            errors.push('the new image is taller/smaller: ' + data.dimensionDifference.height + 'px different');
        }
        errors.push(file)
    }
    if (data.misMatchPercentage > (thresholds.misMatchPercentage || 0)) {
        errors.push('The new image content has changed: ' + data.misMatchPercentage + '% different');
        errors.push(file)
    }
    return errors;
}


function compare(){
    return findFiles(paths.reference).then(function(files){
        
        if (!files || !files.length) {
            console.error('No references were found to compare the new screenshots to. Please accept the previously generated screenshots with `Sheut.accept()`');
            process.exit(1);
        }

        var promises = [],
            file_list = files.split('\n');

        file_list.shift();
        file_list.pop();

        file_list.forEach(function(file){
            promises.push(compareAndSaveDifference(file));
        });

        return Promise.all(promises).then(function(){ return {message: 'Sheut: New images match reference shots'}; });
    });
}

module.exports = {
    clean: clean,
    capture: capture,
    accept: accept,
    compare: compare
};