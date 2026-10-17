import assert from "node:assert/strict";
import {createServer} from "node:net";
import {scanUpload} from "../src/lib/upload-scan";
process.env.UPLOAD_SCAN_REQUIRED="true";delete process.env.CLAMAV_HOST;await assert.rejects(scanUpload(Buffer.from("test")),/unavailable/);
let response="stream: OK\0";const server=createServer(socket=>{let buffer=Buffer.alloc(0);socket.on("data",data=>{buffer=Buffer.concat([buffer,data]);if(buffer.length>=14&&buffer.subarray(-4).equals(Buffer.alloc(4)))socket.end(response);});});await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const address=server.address();assert(address&&typeof address!=="string");process.env.CLAMAV_HOST="127.0.0.1";process.env.CLAMAV_PORT=String(address.port);
try{await scanUpload(Buffer.from("synthetic clean test"));response="stream: Fixture.Test FOUND\0";await assert.rejects(scanUpload(Buffer.from("synthetic blocked test")),/rejected/);response="stream: ERROR\0";await assert.rejects(scanUpload(Buffer.from("synthetic error test")),/could not be scanned/);console.log("Upload scanner: required configuration, clean, blocked and error verdicts passed.");}finally{server.close();}
