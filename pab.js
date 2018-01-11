"use strict"
var fs = require("fs");
var child_process = require("child_process");
var PABglobal; 

var CB_NTHREADS = 0;     // Number of threads
var CB_NBAR0 = 1;     // Number of threads at Barrier 0
var CB_NBAR1 = 2;    // Number of threads at Barrier 1
var CB_BARPHASE = 3;    //
var LOOP_IDX = 4;
var LOOP_START = 5;
var LOOP_END = 6;
var LOOP_CHUNKSZ = 7;
var LOOP_MINCHUNK = 8;
var LOOP_SCHED = 9;
var  SCHED_GUIDED = 901;
var  SCHED_DYNAMIC = 902;



function PABdiag(text) {
	console.log("Task " + this.myID + ": " + text);
}

function PABparForEach(start,         // First iteration's index
                       end,           // Final iteration's index
                       loopBody,      // Function to execute each iteration
                       scheduleType,  // Load balancing technique
                       minChunk) {    // Smallest block of iterations
    var sched = scheduleType;
    var idx;
    if (typeof sched === "undefined") {
        sched = "guided";
    }
    if (typeof minChunk === "undefined") {
        minChunk = 1;
    }
    switch (scheduleType) {
        case "static":     // Evenly divide the iterations across threads
            var range = end - start;
            var blocksz = Math.floor(range / PABglobal.nThreads) + 1;
            var s = blocksz * PABglobal.myID;
            var e = blocksz * (PABglobal.myID + 1);
            if (e > end) {
                e = end;
            }
            for (idx = s; idx < e; idx += 1) {
                loopBody(idx + start);
            }
            break;
        case "dynamic":
        case "guided":
        default:
	    if (PABglobal.myID != 0) PABbarrier();
	    else {
                PABglobal.loopInit(start, end, sched, minChunk);
                PABbarrier();
            }
            do {
                var pos = PABglobal.loopChunk();
            	var s = pos[0];
                var e = pos[1];
                //console.log(PABglobal.myID, s, e);
                for (idx = s; idx < e; idx ++) {
                	loopBody(idx);
                }
            } while (PABglobal.sarr[LOOP_END] > PABglobal.sarr[LOOP_IDX]);
    }
//    PABbarrier();
}


function PABmaster(func) {
    if (this.myID === 0) {
        return func();
    }
}

function PABsingle(func) {
    var retObj;
    if (this.singleTask()) {
        retObj = func();
    }
    PABbarrier();
    return retObj
}

function PABisArray(a) {
    return typeof a.pop !== "undefined"
}

function PABisObject(o) {
    return typeof o === "object" && !PABisArray(o)
}

function PABisDefined(x) {
    return typeof x !== "undefined"
}

function barrier(timeout) {
    var barPhase = PABglobal.sarr[CB_BARPHASE];
    var retval = PABglobal.sarr[CB_NBAR0 + barPhase];
    
    PABglobal.sarr[CB_NBAR0 + barPhase] = PABglobal.sarr[CB_NBAR0 + barPhase] - 1;

    PABglobal.sf.msync(4, 12);

    function sleep(milliSeconds) { 
        return function (cb) {
            setTimeout(cb, milliSeconds);
        };
    }
    
    if (retval < 0) {
        console.log("PABbarrier: Race condition at barrier\n");
        return false;
    }

   if (retval == 1) {
        //  This thread was the last to reach the barrier,
        //  Reset the barrier count for this phase and graduate to the next phase
        PABglobal.sarr[CB_NBAR0 + barPhase] = PABglobal.sarr[CB_NTHREADS];
        PABglobal.sarr[CB_BARPHASE] = !barPhase;
        PABglobal.sf.msync(12,16);
        //console.log("barrier success");
    } else {
        //  Wait for the barrier phase to change, indicating the last thread arrived
        while (timeout > 0  &&  barPhase == PABglobal.sarr[CB_BARPHASE]) {
            sleep(1);
            timeout -= 1;
        }
    }

    return timeout;
}

function PABbarrier(timeout) {
    if (PABglobal.inParallelContext) {
         if(typeof timeout === "undefined") {
            timeout = 500000;  // TODO: Magic number -- long enough for errors, not load imbalance
        }
        var remaining_time = barrier(timeout);
        if (remaining_time < 0) {
            console.log("PABbarrier: ERROR -- Barrier time out after ", timeout, "iterations");
        }
        return remaining_time;
    }
    return timeout;
}

function PABnew(arg0, filename, type) {
    switch (type) {
        case 8: 
            try {
                var pab = new PersistentArrayBuffer(arg0, filename, "o");
                var arr = new Uint8Array(pab);
                break;
            } catch(err) {
                var pab = new PersistentArrayBuffer(arg0, filename, "c");
                var arr = new Uint8Array(pab);
                break;
            }
        case 16:
            try {
                var pab = new PersistentArrayBuffer(arg0 * 2, filename, "o");
                var arr = new Uint16Array(pab);
                break;
            } catch(err) {
                var pab = new PersistentArrayBuffer(arg0 * 2, filename, "c");
                var arr = new Uint16Array(pab);
                break;
            }
        case 32:
            try {
                var pab = new PersistentArrayBuffer(arg0 * 4, filename, "o");
                var arr = new Uint32Array(pab);
                break;
            } catch(err) {
                var pab = new PersistentArrayBuffer(arg0 * 4, filename, "c");
                var arr = new Uint32Array(pab);
                break;
            }
        default:
            try {
                var pab = new PersistentArrayBuffer(arg0 * 4, filename, "o");
                var arr = new Uint32Array(pab);
                break;
            } catch(err) {
                var pab = new PersistentArrayBuffer(arg0 * 4, filename, "c");
                var arr = new Uint32Array(pab);
                break;
            }
    }
 
	function PABwrite(index, value) {
		arr [index] = value;
	}
	
	function PABread(index) {
		return arr[index];
	}

	arr.write = PABwrite;
	arr.read = PABread;

	return [pab, arr];
}

function pab_wrapper(nThreadsArg, threadingType, filename) {
	var retObj = {tasks: []};

	if (process.env.PAB_Subtask !== undefined ) {
        retObj.myID = parseInt(process.env.PAB_Subtask);
    } else {
        retObj.myID = 0;
    }

    var nThreads;
    nThreads = parseInt(nThreadsArg);

	//console.log(nThreads);

    if (!(nThreads > 0)) {
        if (process.env.PAB_Ntasks !== undefined) {
            nThreads = parseInt(process.env.PAB_Ntasks);
        } else {
            console.log("PAB: Must declare number of nodes to use.  Input:" + nThreadsArg);
            process.exit(1);
        }
    }

    var domainName = "/home/zhangqp/shared_PAB/pabfile/PAB_MainDomain";
    if (filename) domainName = filename;

    // This is a shared file which saves the shared metadata for all processes.

    if (retObj.myID === 0) {
        var sf = new PersistentArrayBuffer( 40, domainName, "c");
        var sarr = new Uint32Array(sf);
        sarr[CB_NTHREADS] = nThreads;
        sarr[CB_NBAR0] = nThreads;
        sarr[CB_NBAR1] = nThreads;
        sarr[CB_BARPHASE] = 0;
    }
    else {
        var sf = new PersistentArrayBuffer( 40, domainName, "o");
        var sarr = new Uint32Array(sf);
    }

    function loopInit(start, end, sched, minChunk) {
        retObj.sarr[LOOP_IDX] = start;
        retObj.sarr[LOOP_START] = start;
        retObj.sarr[LOOP_END] = end;

        var success = true;
        switch (sched) {
            case "guided":
                retObj.sarr[LOOP_CHUNKSZ] = ((end - start) / 2) / retObj.sarr[CB_NTHREADS];
                if (retObj.sarr[LOOP_CHUNKSZ] < minChunk) retObj.sarr[LOOP_CHUNKSZ] = minChunk;
                retObj.sarr[LOOP_MINCHUNK] = minChunk;
                retObj.sarr[LOOP_SCHED] = SCHED_GUIDED;
                break;
            case "dynamic":
                retObj.sarr[LOOP_CHUNKSZ] = minChunk;
                retObj.sarr[LOOP_MINCHUNK] = minChunk;
                retObj.sarr[LOOP_SCHED] = SCHED_DYNAMIC;
                break;
            default:
                console.log("NodeJSloopInit: Unknown schedule modes\n");
                success = false;
        }
        return success;
    }

    function loopChunk() {
        var chunksize = retObj.sarr[LOOP_CHUNKSZ];
        var start = retObj.sarr[LOOP_IDX];
        var end = start + chunksize;
        retObj.sarr[LOOP_IDX] = end;
	
        retObj.sf.msync(16, 20);       //LOOP_IDX = 4

        if (start > retObj.sarr[LOOP_END]) end = 0;
        if (end > retObj.sarr[LOOP_END]) end = retObj.sarr[LOOP_END];
        if (retObj.sarr[LOOP_SCHED] == SCHED_GUIDED) {
            var newsz = parseInt(((retObj.sarr[LOOP_END] - end) / 2) / retObj.sarr[CB_NTHREADS]);
            if (newsz < retObj.sarr[LOOP_MINCHUNK]) newsz = retObj.sarr[LOOP_MINCHUNK];
            retObj.sarr[LOOP_CHUNKSZ] = newsz;
            retObj.sf.msync(28, 32);     //LOOP_CHUNKSZ = 7
        }

	//console.log(retObj.myID, start, end);
        return [start, end];
    }


    var targetScript;
    switch (threadingType) {
        case undefined:
        case "bsp":
            targetScript = process.argv[1];
            threadingType = "bsp";
            retObj.inParallelContext = true;
            break;
        case "fj":
            targetScript = "./PABthreadStub";
            retObj.inParallelContext = false;
            break;
        case "user":
            targetScript = undefined;
            retObj.inParallelContext = false;
            break;
        default:
            console.log("PAB: Unknown threading model type:", threadingType);
            retObj.inParallelContext = false;
            break;
    }

	//console.log(threadingType);
	//console.log(retObj.myID);

    if (targetScript !== undefined && retObj.myID === 0) {
        var PABThreadStub =
            "// Automatically Generated PAB Slave Thread Script\n" +
            "// To edit this file, see PAB.js:PABThreadStub()\n" +
            "var PAB = require(\"PAB\")(parseInt(process.env.PAB_Ntasks));\n" +
            "process.on(\"message\", function(msg) {\n" +
            "    eval(\"func = \" + msg.func);\n" +
            "    func.apply(null, msg.args);\n" +
            "} );\n";
        fs.writeFileSync('./PABthreadStub.js', PABThreadStub, {flag: 'w+'});
        process.env.PAB_Ntasks = nThreads;
        for (var taskN = 1; taskN < nThreads; taskN++) {
            process.env.PAB_Subtask = taskN;
            retObj.tasks.push(
                child_process.fork(targetScript,              
                    process.argv.slice(2, process.argv.length)));
        }
    }

    retObj.nThreads = nThreads;
    retObj.threadingType = threadingType;
//    retObj.pinThreads = pinThreads;
    retObj.domainName = domainName;
    retObj.sf = sf;
    retObj.sarr = sarr;
//    retObj.newRegionN = 0;
//    retObj.init = PAB.initialize;
    retObj.new = PABnew;
//    retObj.critical = PABcritical;
//    retObj.criticalEnter = PAB.criticalEnter;
//    retObj.criticalExit  = PAB.criticalExit;
    retObj.master = PABmaster;
    retObj.single = PABsingle;
    retObj.diag = PABdiag;
//    retObj.parallel = PABparallel;
    retObj.barrier = PABbarrier;
    retObj.parForEach = PABparForEach;
//    retObj.tmStart = PABtmStart;
//    retObj.tmEnd = PABtmEnd;
    retObj.loopInit = loopInit;
    retObj.loopChunk = loopChunk;
    PABglobal = retObj;
    return retObj;
}

pab_wrapper.initialize = pab_wrapper;
module.exports = pab_wrapper;
