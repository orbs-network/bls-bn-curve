const {execSync} = require('child_process');
const CWD = __dirname;
const EXEC_PATH = `${CWD}/../bls-bn-curve`;
// const OUTPUT_PATH = `${CWD}/../commit_data.json`;
const {createLogger, format, transports} = require('winston');


const SHOW_DEBUG = false;

const logger = createLogger({
  format: format.json(),
  transports: [
    new transports.Console(({
      format: format.simple(),
      level: SHOW_DEBUG ? 'debug' : 'info'
    }))
    // new winston.transports.File({ filename: 'combined.log' })
  ]
});


function runExternal(cmd) {
  return execSync(cmd, {cwd: CWD}, {stdio: [0, 1, 2]});
}

function GetCommitDataForAllParticipants(threshold, clientCount, outputPath) {
  const cmd = `${EXEC_PATH} -func=GetCommitDataForAllParticipants ${threshold} ${clientCount} ${outputPath}`;

  logger.info(`Calling external command ${cmd}`);
  const res = runExternal(cmd);
  const json = require(outputPath);
  logger.debug(`GetCommitDataForAllParticipants(): Read data from file: ${JSON.stringify(json)}`);
  return res;
}

function GetCommitDataForAllParticipantsWithIntentionalErrors(threshold, clientCount, complainerIndex, maliciousIndex, outputPath) {
  const cmd = `${EXEC_PATH} -func=GetCommitDataForAllParticipantsWithIntentionalErrors ${threshold} ${clientCount} ${complainerIndex} ${maliciousIndex} ${outputPath}`;

  logger.info(`Calling external command ${cmd}`);
  const res = runExternal(cmd);
  const json = require(outputPath);
  logger.debug(`GetCommitDataForAllParticipantsWithIntentionalErrors(): Read data from file: ${JSON.stringify(json)}`);
  return res;
}

function VerifyPrivateCommitment(complainerIndex, accusedIndex, outputPath) {
  const cmd = `${EXEC_PATH} -func=VerifyPrivateCommitment ${complainerIndex} ${accusedIndex} ${outputPath}`;
  logger.info(`Calling external command ${cmd}`);
  const buf = runExternal(cmd);
  // const json = require(outputPath);
  logger.debug(`VerifyPrivateCommitment(): Returned buffer: ${buf}`);
  return buf;
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


function SignAndVerify(threshold, clientCount, outputPath) {
  // const json = require(outputPath);
  const cmd = `${EXEC_PATH} -func=SignAndVerify ${threshold} ${clientCount} ${outputPath}`;
  logger.info(`Calling external command ${cmd}`);
  const stdoutBuffer = execSync(cmd, {cwd: CWD});
  logger.debug(stdoutBuffer.toString());
  return stdoutBuffer;
}


module.exports = {
  GetCommitDataForAllParticipants: GetCommitDataForAllParticipants,
  GetCommitDataForAllParticipantsWithIntentionalErrors: GetCommitDataForAllParticipantsWithIntentionalErrors,
  SignAndVerify: SignAndVerify,
  VerifyPrivateCommitment: VerifyPrivateCommitment,
  logger: logger
};