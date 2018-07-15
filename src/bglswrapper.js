const {execSync} = require('child_process');
const CWD = __dirname;
const EXEC_PATH = `${CWD}/../bls-bn-curve`;
const OUTPUT_PATH = `${CWD}/../commit_data.json`;

function GetCommitDataForAllParticipants(threshold, clientCount) {
  const cmd = `${EXEC_PATH} -func=GetCommitDataForAllParticipants ${clientCount} ${threshold} ${OUTPUT_PATH}`;

  console.log(`Calling external command ${cmd}`);
  execSync(cmd, {cwd: CWD});
  const json = require(OUTPUT_PATH);
  console.log("Read data from file:", JSON.stringify(json));
  return json;
}


// TODO: Call Go code that does all this:
// TODO: Find how Go can retain prvCommit, pubG1, pubG2 from previous run (maybe persist in file)

// Calculate SK (GetSecretKey - returns bigint) - run this for each client
// PKs (GetAllPublicKey - return []Point, one Point for each client)
// and group PK (GetGroupPublicKey - returns Point)

// Sign and reconstruct
// Call Sign(sk, msg) returns Point (the sig)
// Take sigs of clients [0,1,2] and [2,3,4] and call SigReconstruct(sigs, signerIndices (client.id from join()))
// REMEMBER: Indexes in Solidity start from 1, not 0.
// Returns the sig (Point) of the group
// SHOW THAT BOTH SIGS ARE THE SAME AND WE ARE DONE!


function SignAndVerify(threshold, clientCount) {
  const json = require(OUTPUT_PATH);
  const cmd = `${EXEC_PATH} -func=SignAndVerify ${clientCount} ${threshold} ${JSON.stringify(json)}`;
  const stdoutBuffer = execSync(cmd, {cwd: CWD});
  console.log(stdoutBuffer.toString());
  return stdoutBuffer;
}


module.exports = {
  GetCommitDataForAllParticipants: GetCommitDataForAllParticipants,
  SignAndVerify: SignAndVerify
};