
const PATH = require("path");
const HTMLPARSER = require("htmlparser");


exports.for = function(API, plugin) {


    plugin.resolveLocator = function(locator, options, callback) {
        var self = this;

        if (!locator.version && !locator.selector && locator.descriptor.pointer) {

            var matched = false;
            var m;
            if((m = locator.descriptor.pointer.match(/^([^@]*)@(.*)$/))) {
                locator.pm = "pip";
                locator.vendor = "pip";
                locator.id = m[1];
                locator.selector = m[2];
                matched = true;
            } else
            // e.g. `http://pypi.python.org/packages/source/d/dotcloud/dotcloud-0.9.4.tar.gz`
            if((m = locator.descriptor.pointer.match(/pypi.python.org\/packages\/source\/d\/([^\/]*)\/(.*)$/))) {
                locator.pm = "pip";
                locator.vendor = "pip";
                locator.id = m[1];
                if (m[2].substring(0, m[1].length+1) === (m[1] + "-")) {
                    if((m = m[2].substring(m[1].length+1).match(/^(.*)\.tar\.gz$/))) {
                        locator.version = m[1];
                    }
                }
                matched = true;
            }

            if (matched) {
                locator.getLocation = function(type) {
                    var locations = {
                        "status": "http://pypi.python.org/simple/" + this.id + "/",
                        // Without reading the descriptor this is as close as we can get to the homepage.
                        "homepage": "http://pypi.python.org/pypi/" + this.id
                    };
                    if (this.version) {
                        locations.gzip = "http://pypi.python.org/packages/source/d/" + this.id + "/" + this.id + "-" + this.version + ".tar.gz";
                        locations.pointer = locations.gzip;
                    }
                    return (type)?locations[type]:locations;
                }
            }
        }

        return callback(null, locator);
    }

    plugin.latest = function(options, callback) {
        var self = this;
        if (
            !self.node.name ||
            !self.node.summary.declaredLocator ||
            self.node.summary.declaredLocator.descriptor.pm !== "pip"
        ) return callback(null, false);

        var uri = self.node.summary.declaredLocator.getLocation("status");
        if (!uri) return callback(null, false);

        var opts = API.UTIL.copy(options);
        opts.loadBody = true;
        opts.ttl = API.HELPERS.ttlForOptions(options);
        function fetch(options, callback) {
            return self.fetchExternalUri(uri, options, function(err, response) {
                if (err) return callback(err);
                var summary = {};
                if (response.status === 200 || response.status === 304) {
                    try {
                        var handler = new HTMLPARSER.DefaultHandler(function(err, dom) {
                            if (err) return callback(err);

                            try {

                                summary.published = true;
                                summary.descriptor = {
                                    "name": self.node.summary.declaredLocator.id
                                };
                                summary.versions = {};

                                // @see http://guide.python-distribute.org/contributing.html#the-simple-index-protocol

                                function findTags(nodes, name) {
                                    var tags = [];
                                    for (var i=0 ; i<nodes.length ; i++) {
                                        if (nodes[i].type === "tag" && nodes[i].name === name) {
                                            tags.push(nodes[i]);
                                        }
                                    }
                                    return tags;
                                }

                                var tags = findTags(findTags(dom, "html")[0].children, "body")[0].children;

                                findTags(tags, "a").forEach(function(tag) {
                                    if (!tag.attribs) return;
                                    if (tag.attribs.rel === "homepage") {
                                        // Ignore
                                    } else
                                    if (tag.attribs.href) {

                                        if (/#md5=/.test(tag.attribs.href)) {
                                            // We seem to have found a link to a release.
                                            var m = tag.attribs.href.match(/(^.*?-(.*?)\.tar\.gz)#md5=/);
                                            if (m) {
                                                summary.versions[m[2]] = {
                                                    version: m[2]
                                                };
                                                // Download URL: `PATH.join(uri, m[1])`.
                                            }
                                        } else {
                                            // The last found link seems to be the homepage.
                                            summary.descriptor.homepage = tag.attribs.href;
                                        }
                                    }
                                });

                                // Find latest version based on `summary.versions`.
                                summary.version = API.SEMVER.maxSatisfying(Object.keys(summary.versions), "*");

                                return callback(null, [response, summary]);
                            } catch(err) {
                                return callback(err);
                            }
                        });
                        return new HTMLPARSER.Parser(handler).parseComplete(response.body.toString());
                    } catch(err) {
                        return callback(err);
                    }
                } else
                if (response.status === 404) {
                    summary.published = false;
                    return callback(null, [response, summary]);
                } else {
                    return callback(new Error("Got response status '" + response.status + "' for '" + uri + "'!"));
                }
            });
        }

        return fetch(opts, function(err, response) {
            if (err) return callback(err);
            return callback(null, response[1]);
        });
    }

    plugin.install = function(packagePath, options) {
        var self = this;
        var virtualenvPath = packagePath + "~venv";
        function initEnv(virtualenvBinPath, callback) {
            console.log("Creating virtualenv at: ", virtualenvPath);
            var opts = API.UTIL.copy(options);
            opts.cwd = virtualenvPath;
            return API.OS.spawnInline(virtualenvBinPath, [
                virtualenvPath
            ], opts).then(function() {
                var easyInstallPath = PATH.resolve(virtualenvPath, "bin/easy_install");
                if (!PATH.existsSync(easyInstallPath)) {
                    throw new Error("virtualenv local 'easy_install' not found at '" + easyInstallPath + "'");
                }
                return API.OS.spawnInline(easyInstallPath, [
                    "pip"
                ], opts);
            });
        }
        return API.OS.which("virtualenv").then(function(virtualenvBinPath) {
            if (!virtualenvBinPath) {
                // TODO: Display instructions on how to install `virtualenv`.
                throw new Error("`virtualenv` no found on `PATH`");
            }
            API.FS.mkdirs(virtualenvPath);
            return initEnv(virtualenvBinPath).then(function() {

                var installerPath = PATH.join(virtualenvPath, ".install.sh");

                // Write install script so we can call `pip` within the context for our virtualenv.
                API.FS.writeFileSync(installerPath, [
                    "#!/bin/bash",
                    "source bin/activate",
                    "pip install " + packagePath
                ].join("\n"));
                API.FS.chmodSync(installerPath, 0755);

                var opts = API.UTIL.copy(options);
                opts.cwd = virtualenvPath;
                return API.OS.spawnInline(installerPath, [], opts).then(function() {
                    API.FS.removeSync(installerPath);

                    // Get important info from package that we need to interface with it.
                    var packageInfo = {};
                    API.FS.readFileSync(PATH.join(packagePath, "PKG-INFO")).toString().split("\n").forEach(function(line) {
                        var m = line.match(/^([^:]*):\s+(.*?)$/);
                        if (m) {
                            packageInfo[m[1]] = m[2];
                        };
                    });
                    var setupInfo = {};
                    var setupInfoSource = API.FS.readFileSync(PATH.join(packagePath, "setup.py")).toString();
                    var bins = setupInfoSource.match(/scripts[\s\n]*=[\s\n]*\[[\s\n]*([^\]]*)[\s\n]*\][\s\n]*/m);
                    if (bins && bins[1]) {
                        setupInfo.bin = {};
                        var re = /'([^']*)'/g;
                        var match;
                        while (match = re.exec(bins[1])) {
                            if (match[1]) {
                                setupInfo.bin[match[1].split("/").pop()] = match[1];
                            }
                        }
                    }

                    // Write wrappers for bins so we can call them with the correct virtualenv.
                    if (setupInfo.bin) {
                        for (var alias in setupInfo.bin) {
                            var wrapperPath = PATH.join(virtualenvPath, "bin", alias + "~wrapper");
                            API.FS.writeFileSync(wrapperPath, [
                                "#!/bin/bash",
                                'SOURCE="${BASH_SOURCE[0]}"',
                                'while [ -h "$SOURCE" ]; do # resolve $SOURCE until the file is no longer a symlink',
                                '  DIR="$( cd -P "$( dirname "$SOURCE" )" && pwd )"',
                                '  LAST_SOURCE=$SOURCE',
                                '  SOURCE="$(readlink "$SOURCE")"',
                                '  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE" # if $SOURCE was a relative symlink, we need to resolve it relative to the path where the symlink file was located',
                                'done',
                                'BASE_PATH="$( cd -P "$( dirname "$SOURCE" )" && pwd )"',
                                "source $BASE_PATH/activate",
                                alias + ' "$@"'
                            ].join("\n"));
                            API.FS.chmodSync(wrapperPath, 0755);
                            setupInfo.bin[alias] = "./bin/" + alias + "~wrapper"
                        }
                    }

                    // TODO: Write `.package.json` instead of `package.json`.
                    API.FS.writeFileSync(PATH.join(virtualenvPath, "package.json"), JSON.stringify({
                        name: packageInfo.Name,
                        version: packageInfo.Version,
                        homepage: packageInfo["Home-page"],
                        bin: setupInfo.bin || {}
                    }, null, 4));

                    API.FS.removeSync(packagePath);
                    API.FS.renameSync(virtualenvPath, packagePath);
                });
            });
        }).fail(function(err) {
            if (API.FS.existsSync(virtualenvPath)) {
                API.FS.removeSync(virtualenvPath);
            }
            throw err;
        });
    }
}
