
const PATH = require("path");


exports.for = function(API, plugin) {

    plugin.install = function(packagePath, options) {
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
                ], opts).then(function() {
                    var pipPath = PATH.resolve(virtualenvPath, "bin/pip");
                    if (!PATH.existsSync(pipPath)) {
                        throw new Error("virtualenv local 'pip' not found at '" + pipPath + "'");
                    }
                    return pipPath;
                });
            });
        }
        return API.OS.which("virtualenv").then(function(virtualenvBinPath) {
            if (!virtualenvBinPath) {
                // TODO: Display instructions on how to install `virtualenv`.
                throw new Error("`virtualenv` no found on `PATH`");
            }
            API.FS.mkdirs(virtualenvPath);
            return initEnv(virtualenvBinPath).then(function(pipPath) {
                var opts = API.UTIL.copy(options);
                opts.cwd = virtualenvPath;
                return API.OS.spawnInline(pipPath, [
                    "install",
                    packagePath
                ], opts).then(function() {
                    API.FS.removeSync(packagePath);
                    API.FS.renameSync(virtualenvPath, packagePath);

                    // TODO: Write package.json file if it does not exist and declare bins so they get installed.

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
