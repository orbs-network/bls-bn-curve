const {execSync} = require('child_process');
const CWD = "../bglswrapper";

function GetCommitDataForAllParticipants(threshold, clientCount) {
  const cmd = `${CWD}/bglsmain -func=GetCommitDataForAllParticipants ${threshold} ${clientCount}`;
  const stdoutBuffer = execSync(cmd, {cwd: CWD});
  console.log(stdoutBuffer.toString());
}

function SignAndVerify(threshold, clientCount, allData) {
  const cmd = `${CWD}/bglsmain -func=SignAndVerify ${threshold} ${clientCount} ${JSON.stringify(allData)}`;
  const stdoutBuffer = execSync(cmd, {cwd: CWD});
  console.log(stdoutBuffer.toString());

}


module.exports = {
  GetCommitDataForAllParticipants: GetCommitDataForAllParticipants,
  SignAndVerify: SignAndVerify
};