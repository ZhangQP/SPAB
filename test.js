var pab = require('./pab.js')(parseInt(process.argv[2]));

var arrLen = 20000000;
var x = pab.new(arrLen, "/home/zhangqp/shared_PAB/pabfile/a", 32);
var p1 = x[0];
var a = x[1];
var y = pab.new(arrLen, "/home/zhangqp/shared_PAB/pabfile/b", 32);
var p2 = y[0];
var b = y[1];
var z = pab.new(arrLen, "/home/zhangqp/shared_PAB/pabfile/c", 32);
var p3 = z[0];
var c = z[1];

//-------------------------------------------------------------------
//  Timer function
function stopTimer(timer, nOps, label) {
    function fmtNumber(n) {
        var s = '                       ' + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        if(n < 1) return n;
        else    { return s.substr(s.length - 15, s.length); }
    }
    pab.master( function() {
        var now = new Date().getTime();
        var x = (nOps*1000000) / ((now - timer) *1000);
        pab.diag(fmtNumber(nOps) + label + fmtNumber(Math.floor(x).toString()) + " ops/sec");
    } );
}


var timeStart = new Date().getTime();
pab.parForEach(0, arrLen, function(idx) { a.write(idx, idx);  if (idx % 1000000 == 0) {console.log(pab.myID, idx, a.read(idx))}}, "guided", 2000);
//pab.parForEach(0, arrLen, function(idx) { a.write(idx, idx)}, "static");
stopTimer(timeStart, arrLen, " write   ");

var timeStart = new Date().getTime();
pab.parForEach(0, arrLen, function(idx) { a.read(idx) }, "guided", 2000 );
//pab.parForEach(0, arrLen, function(idx) { a.read(idx); }, "static" );
stopTimer(timeStart, arrLen, " read  ");

var timeStart = new Date().getTime();
pab.parForEach(0, arrLen, function(idx) { b.write(idx, a.read(idx))}, "guided", 2000);
//pab.parForEach(0, arrLen, function(idx) { b.write(idx, a.read(idx)); }, "static");
stopTimer(timeStart, arrLen, " copy   ");

pab.barrier();

var timeStart = new Date().getTime();
pab.parForEach(0, arrLen, function(idx) { b.write(idx, 2)}, "guided", 2000);
//pab.parForEach(0, arrLen, function(idx) { b.write(idx, 2); }, "static");
stopTimer(timeStart, arrLen, " copy   ");

p2.msync(0, arrLen * 8);
pab.barrier();

var timeStart = new Date().getTime();
pab.parForEach(0, arrLen, function(idx) { c.write(idx, a.read(idx) * b.read(idx)); if (idx % 1000000 == 0) {console.log(pab.myID, idx, a.read(idx) * b.read(idx), c.read(idx))} },"guided", 2000);
//pab.parForEach(0, arrLen, function(idx) { c.write(idx, (a.read(idx) * b.read(idx))); if (idx % 1000000 == 0) {console.log(pab.myID, idx, a.read(idx) * b.read(idx), c.read(idx))}  }, "static");
stopTimer(timeStart, arrLen, " c = a * b   ");

p3.msync(0, arrLen * 8);
pab.barrier();

//var timeStart = new Date().getTime();
//pab.parForEach(0, arrLen, function(idx) { c.write(idx, c.read(idx) + (a.read(idx) * b.read(idx))); if (idx % 1000000 == 0) {console.log(pab.myID, idx, a.read(idx) * b.read(idx), c.read(idx))} }, "guided", 2000);
//pab.parForEach(0, arrLen, function(idx) { c.write(idx, c.read(idx) + (a.read(idx) * b.read(idx))); if (idx % 1000000 == 0) {console.log(pab.myID, idx, a.read(idx) * b.read(idx), c.read(idx))} }, "static");
//stopTimer(timeStart, arrLen, " c += a * b   ");
