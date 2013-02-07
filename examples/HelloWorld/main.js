
const PATH = require("path");
const EXEC = require("child_process").exec;


var command = "python " + PATH.join(__dirname, "node_modules", "my-pip-pkg", "bin", "helloworld.py")

EXEC(command, function(error, stdout, stderr) {
    if (error || stderr) {
    	console.error(stderr);
    	process.exit(1);
    }
    console.log(stdout);
    process.exit(0);
});
