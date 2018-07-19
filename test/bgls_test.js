const chai = require('chai');
const dirtyChai = require('dirty-chai');
const bgls = require('../src/bglswrapper.js');
const logger = bgls.logger;
const _ = require('lodash');
const pause = bgls.pause;

// Run tests:  scripts/test.sh

// Step-by-step debugging in VSCode:
// npm install truffle-core --save-dev
// node --inspect-brk ./node_modules/truffle-core/cli.js test test/bgls_test.js
// "Attach" in VSCode (see .vscode/launch.json)

// Print exec + tx cost for every contract call

// Add json.Marshal to Go when it returns from getCommitInputs
// Parse on JS side (this file)
// Send as param (single string) to Go's SignAndVerify() and parse there with json.Unmarshal.
// Destructure and use as params for SignAndVerify()
// Inside SignAndVerify() use dkg_test.go as blueprint.
// Listen to event after commit to know when we are done.


chai.use(dirtyChai);

const ETH_URL = "http://127.0.0.1:7545";
// const CONTRACT_ADDRESS = '0xF7d58983Dbe1c84E03a789A8A2274118CC29b5da';
const Web3 = require('web3');

// See https://github.com/ethereum/web3.js/issues/1119
Web3.providers.HttpProvider.prototype.sendAsync = Web3.providers.HttpProvider.prototype.send;
const web3 = new Web3(new Web3.providers.HttpProvider(ETH_URL));

const CLIENT_COUNT = 22;
// const CLIENT_COUNT = 5;
const THRESHOLD = 14;
// const THRESHOLD = 2;
const DEPOSIT_WEI = 25000000000000000000; // 1e18 * 25
const MIN_BLOCKS_MINED_TILL_COMMIT_IS_APPROVED = 11;

const CLIENTS = require('../clients.json');
const gasUsed = {join: 0, commit: 0, phaseChange: 0};

const DKGG2 = artifacts.require('../contracts/dkgG2.sol');

const COMPLAINER_INDEX = 2; // 1-based
const ACCUSED_INDEX = 1; // 1-based

let dkgContract;
let allCommitDataJson;

logger.info('===> Start <===');

// The done() calls are there because this code is meant to be presented with pauses.
// Mocha will throw error if idle for 5 minutes and there is no done() callback.


contract('dkgG2', (accounts) => {

  // it('===> Happy flow', async () => {
  //   logger.info('Now running happy flow');
  //   await deploy(accounts);
  //   await joinAllClients();
  //   getCommitData();
  //   await commitAllClients(allCommitDataJson);
  //   await phaseChange(CLIENTS[0]);
  //   signAndVerify();
  //   logger.info('Completed happy flow');
  // });

  it('===> Complaint flow', async () => {
    const COMPLAINER_INDEX = 2;
    const ACCUSED_INDEX = 1;
    logger.info('Now running a flow where one of the clients sends invalid commitments, and another client complains about it');
    await deploy(accounts);
    await joinAllClients();
    getCommitDataWithErrors(); // taint prv [0][1]
    await commitAllClients(allCommitDataJson);
    verifyPrivateCommit(COMPLAINER_INDEX, ACCUSED_INDEX); // TODO   Fill this
    await sendComplaint(COMPLAINER_INDEX, ACCUSED_INDEX);
    logger.info('Completed complaint flow');
  });

});

async function join(client, i) {
  logger.info(`Calling join() with client ${toShortHex(client.address)}`);
  const res = await dkgContract.join({
    from: client.address,
    value: DEPOSIT_WEI,
    gasLimit: 3000000,
  });
  client.id = null;
  for (let j = 0; j < res.logs.length; j++) {
    const log = res.logs[j];

    if (log.event === "ParticipantJoined") {
      client.id = log.args.index;


      break;
    }
  }
  if (client.id === null) {
    throw new Error(`Client ${client.address} did not receive an ID from join(), cannot continue`);
  }
  logger.info(`Client ${toShortHex(client.address)} joined successfully and received ID [${client.id}]. Block: ${res.receipt.blockNumber}`);
  logger.debug(`Client ${client.address} joined successfully. Result: ${JSON.stringify(res)}`);
  logger.info(`Client ID #${client.id} of ${CLIENTS.length}: Gas used: ${res.receipt.gasUsed}`);
  // console.log('');
  gasUsed.join += res.receipt.gasUsed;
  client.gasUsed += res.receipt.gasUsed;
  return res;
}

async function joinAllClients() {
  logger.info('=====> Starting join <=====');
  let i = 0;
  for (const client of CLIENTS) {
    logger.debug(`Calling join() with client ID #${i + 1}`);

    if (i < 2) {
      pause();
    }
    const res = await join(client, i);
    // logger.debug(`Result of join() with client ID #${i+1}: ${JSON.stringify(res)}`);
    i++;
  }
  logger.info(`***** Total gas used for join(): ${gasUsed.join} *****`);
  console.log('');
  pause();
}

/// Commit


// TODO Remove this - done on Go side
function taintCommitmentData(json) {
  const {CoefficientsAll, PubCommitG1All, PubCommitG2All, PrvCommitAll} = json;

  const clientIdToTaint = 1;

  const originalValue = PubCommitG1All[clientIdToTaint][0][0];
  // logger.info(`originalValue: ${originalValue} ${JSON.stringify(originalValue)}`);
  const lastChar = originalValue.substring(originalValue.length - 1);
  const taintedLastChar = lastChar === "0" ? "1" : "0";
  const taintedValue = originalValue.substring(0, originalValue.length - 1) + taintedLastChar;

  PubCommitG1All[clientIdToTaint][0][0] = taintedValue;
  logger.info(`Original Value: ${originalValue} ; taintedValue: ${taintedValue}`);
  logger.info(`PubCommitG1All[clientIdToTaint][0]: ${PubCommitG1All[clientIdToTaint][0]}`);
}

function verifyPrivateCommit(complainerIndex, accusedIndex) {

  logger.info(`Now client ID #${complainerIndex} is verifying the private commitment of client ID #${accusedIndex}`);
  logger.info(`The private commitment of client ID #${accusedIndex} was intentionally tainted.`);


  const verifyResult = bgls.VerifyPrivateCommitment(complainerIndex, accusedIndex);
  logger.info(`Verification passed? ${verifyResult}`);
  return verifyResult;
}

async function commitAllClients(json) {
  logger.info(` =====> Starting commit <=====`);
  const {CoefficientsAll, PubCommitG1All, PubCommitG2All, PrvCommitAll} = json;

  logger.info("Notice the difference in gas costs between join() and commit()");

  let i = 0;
  for (const client of CLIENTS) {
    logger.debug("Calling commit()", i);
    if (i < 2) {
      pause();
    }
    const res = await commit(client, i, CoefficientsAll[i], PubCommitG1All[i], PubCommitG2All[i], PrvCommitAll[i]);
    i++;
  }
  logger.info(`***** Total gas used for commit(): ${gasUsed.commit} *****`);
  console.log('');
  pause();
}

async function sendComplaint(complainerIndex, accusedIndex) {

  logger.info(`Now client ID #${complainerIndex} is sending a complaint on client ID #${accusedIndex}`);
  pause();
  const res = await dkgContract.complaintPrivateCommit(complainerIndex, accusedIndex, {
    from: CLIENTS[complainerIndex - 1].address,
    gasLimit: 3000000
  });

  logger.info(`Complaint sent. If the complaint was justified, the deposit of the accused client was split between the other clients, who also had their deposits returned.`);
  logger.info(`If the complaint was not justified, the deposit of the complaining client was split between the other clients, who also had their deposits returned.`);
  logger.info(`In either case, the contract is closed.`);


}


async function commit(client, i, coeffs, commitG1, commitG2, commitPrv) {

  // const data = await dkgwrapper.GetCommitDataForAllParticipants(client, i);
  // const {pubCommitG1, pubCommitG2, prCommit} = data;

  // const pubCommitG1 = getPubCommitG1();
  // const pubCommitG2 = getPubCommitG2();
  // const prCommit = getPrCommit();
  if (!client.id) {
    throw new Error(`Missing client id for client #${i}. Client id is the result of join(). Did join() finished correctly?`);
  }

  // TODO: each "e" below is a pair or a quad, not a single string, so toBiGNumber() on it fails.
  // Instead, convert each "e" to and array of big numbers and then flatMap commitG1 so the resulting array will be x0,y0,x1,y1,... coords
  // FIXME: what is e?????????? it doesn't work.
  const commitG1BigInts = commitG1.map(e => e.map(numstr => {
    const biggie = web3.toHex(numstr);
    /*logger.info(`numstr: ${numstr} biggie: ${biggie}`); */
    return biggie;
  }));
  const commitG2BigInts = commitG2.map(e => e.map(numstr => web3.toHex(numstr)));
  const prvBigInts = commitPrv.map(numstr => web3.toHex(numstr));

  logger.info(`===> Commit(Index=${client.id}) <===`);
  logger.debug(`commitG1BigInts: ${JSON.stringify(commitG1BigInts)}`);
  logger.debug(`commitG2BigInts: ${JSON.stringify(commitG2BigInts)}`);
  logger.debug(`commitPrvBigInts=${JSON.stringify(prvBigInts)}`);
  const g1Flat = _.flatMap(commitG1BigInts);
  const g2Flat = _.flatMap(commitG2BigInts);
  logger.debug(`g1Flat: ${JSON.stringify(g1Flat)}`);
  logger.debug(`g2Flat: ${JSON.stringify(g2Flat)}`);
  const res = await dkgContract.commit(client.id, g1Flat, g2Flat, prvBigInts, {
    from: client.address,
    gasLimit: 3000000
  });

  // Each client saves the pubCommitG1 and pubCommitG2 of ALL clients (save under its sender index),
  // prCommit[] is an array of bigints (f(i))(2) for all client indexes, but generated with the current client's coeffs.

  for (let j = 0; j < res.logs.length; j++) {
    var log = res.logs[j];

    if (log.event === "NewCommit") {
      logger.debug(`Client ID #${client.id} received NewCommit: ${JSON.stringify(log)}`);
      client.committed = true;
      // client.id = log.args.index;
      // logger.info(`Client #${i} received ID [${client.id}] from join()`);
      break;
    }
  }

  if (!client.committed) {
    throw new Error(`Client #${i} ${client.address} - commit() failed!`);
  }

  logger.info(`Client ID #${client.id} ${client.address} committed successfully`);
  logger.info(`Client ID #${client.id} of ${CLIENTS.length} *** Gas used: ${res.receipt.gasUsed}. *** Block ${res.receipt.blockNumber}`);
  console.log('');
  gasUsed.commit += res.receipt.gasUsed;
  client.gasUsed += res.receipt.gasUsed;

  logger.debug(`Commit(): Client ID #${client.id} ${client.address} committed successfully. Result: ${JSON.stringify(res)}`);
}

function getCommitData() {
  bgls.GetCommitDataForAllParticipants(THRESHOLD, CLIENT_COUNT);
  allCommitDataJson = require(bgls.OUTPUT_PATH);
  // printDataPerClient(allCommitDataJson);
  logger.debug('Read contents of file ', bgls.OUTPUT_PATH);
  // pause();

}

function getCommitDataWithErrors() {
  bgls.GetCommitDataForAllParticipantsWithIntentionalErrors(THRESHOLD, CLIENT_COUNT);
  logger.info(`Reading data file (with intentional errors) ${bgls.OUTPUT_PATH} ...`);
  allCommitDataJson = require(bgls.OUTPUT_PATH);
  logger.debug('Read contents of file (with intentional errors)', bgls.OUTPUT_PATH);
}

async function deploy(accounts) {
  dkgContract = await DKGG2.new(THRESHOLD, CLIENT_COUNT, DEPOSIT_WEI);
  // TODO Use deployed() here?
  logger.info(`Deployed DKG contract on address ${dkgContract.address}, txHash: ${dkgContract.transactionHash}`);
  logger.info(`Contract properties: numParticipants=${CLIENT_COUNT}  | threshold=${THRESHOLD} | depositWei=${DEPOSIT_WEI}`);
  // accounts.forEach((a, i) => logger.info(`Account ${i}: ${accounts[i]}`));
  // await printValuesFromContract();
  pause();
}

function signAndVerify() {
  pause();
  bgls.SignAndVerify(THRESHOLD, CLIENT_COUNT);
}

async function phaseChange(client) {

// TODO Client 0 to call dkgContract.phaseChange() and verify it runs. Don't send deposit.
// TODO return how much gas was spent for all calls for each client
// Separate to execution cost (function of opcodes) and transaction cost (execution cost + fixed cost per tx)

  logger.info(`We will now mine ${MIN_BLOCKS_MINED_TILL_COMMIT_IS_APPROVED} blocks to simulate that no one complained for some time after all commits were executed, therefore it is safe to finalize the commit() phase`);

  // FIXME

  // logger.info('Block number before mining: ', web3.eth.blockNumber);
  pause();
  await mineNBlocks(11);

  // FIXME

  // logger.info('Block number after mining: ', web3.eth.blockNumber);
  logger.info(`No one complained, so calling phaseChange() to finalize commit phase. `);
  logger.info(`Take note of the present balance of accounts and compare to after calling phaseChange().`);
  pause();
  const res = await dkgContract.phaseChange({
    from: client.address,
    gasLimit: 3000000
  });

  logger.info(`phaseChange(): finished successfully. *** Gas used: ${res.receipt.gasUsed}. *** Block: ${res.receipt.blockNumber}`);
  console.log('');
  gasUsed.phaseChange += res.receipt.gasUsed;
  client.gasUsed += res.receipt.gasUsed;
  logger.debug(`phaseChange(): finished successfully. Result: ${JSON.stringify(res)}`);

  logger.info('Now take note again of accounts balance, now that deposits have been refunded.');
  console.log('');
  logger.info(`***** Total gas used: ${getTotalGasUsed()} *****`);
  console.log('');

  for (const client of CLIENTS) {
    logger.info(`Total gas used by client ${client.id}: ${client.gasUsed}`);
  }

  pause();
}

function getTotalGasUsed() {
  return gasUsed.join + gasUsed.commit + gasUsed.phaseChange;
}

const mineOneBlock = async () => {

  // TODO replace this print with just the block number

  // logger.info(JSON.stringify(web3.eth));

  await web3.currentProvider.send({
    jsonrpc: '2.0',
    method: 'evm_mine',
    params: [],
    id: 200,
  });
};

const mineNBlocks = async n => {
  for (let i = 0; i < n; i++) {
    await mineOneBlock()
  }
};

async function printValuesFromContract() {
  const valuesFromContract = {};
  logger.debug("Get n");
  valuesFromContract.n = await dkgContract.n.call();
  logger.debug("Get t");
  valuesFromContract.t = await dkgContract.t.call();
  logger.debug("Get p");
  valuesFromContract.p = await dkgContract.p.call();
  logger.debug("Get q");
  valuesFromContract.q = await dkgContract.q.call();

  // FIXME This doesn't work
  // logger.debug("Get g1");
  // valuesFromContract.g1 = await dkgContract.g1.call();
  // logger.debug("Get g2");
  // valuesFromContract.g2 = await dkgContract.g2.call();
  logger.info(`Reading values directly from contract: ${JSON.stringify(valuesFromContract)}`);
  logger.info(`Reading values directly from contract: ${valuesFromContract.p.toString()}`);
  logger.info(`Reading values directly from contract: ${valuesFromContract.q.toString()}`);

}

function printAccounts() {
  for (const a of CLIENTS) {
    logger.info(`Account: ${a.address}`)
  }
  logger.info(`Total of ${CLIENTS.length} accounts`);
}

function toShortHex(hexStr) {
  return hexStr.substr(0, 6) + ".." + hexStr.substr(hexStr.length - 4);
}

function printDataPerClient(data) {

  // TODO Fix text and contents here

  CLIENTS.forEach((client, i) => {
    pause();
    console.log('');
    logger.info(`===> Data for client ID #${client.id} ${client.address} <===`);
    logger.info(`===================================================`);
    for (let j = 0; j < data.CoefficientsAll[i].length; j++) {
      logger.info(`Client ID #${i + 1}: Coefficient ${j}: ${data.CoefficientsAll[i][j]}`);
    }
    for (let j = 0; j < data.PubCommitG1All[i].length; j++) {
      logger.info(`Client ID #${i + 1}: Commitment on G1 for coefficient ${j}: ${data.PubCommitG1All[i][j]}`);
    }

    for (let j = 0; j < data.PubCommitG2All[i].length; j++) {
      logger.info(`Client ID #${i + 1}: Commitment on G2 for coefficient ${j}: ${data.PubCommitG2All[i][j]}`);
    }

    for (let j = 0; j < data.PrvCommitAll[i].length; j++) {
      logger.info(`Client ID #${i + 1}: f_${i + 1}(${j + 1}) = ${toShortHex(data.PrvCommitAll[i][j])}`);
    }

  });


  logger.info("")
}

/*
function getCommitInputs() {
  const cmd = `${CWD}/dkgmain -func=GetCommitInputs`;
  const stdoutBuffer = execSync(cmd, {cwd: CWD});
  logger.info(stdoutBuffer.toString());

}

// This should call Go code - it is just a mock here
function getPubCommitG1() {

  const SOME_BIG_NUMBER = '0xfc9e0eefe9f3a5101b7c025b217c03c95dbf9bb4f2d1d46db238e305af104103';
  const res = [];
  const pubCommitLength = THRESHOLD * 2 + 2;
  for (let i = 0; i < pubCommitLength; i++) {
    res.push(web3.toHex(SOME_BIG_NUMBER));
  }
  return res;
}

function getPubCommitG2() {

  const SOME_BIG_NUMBER = '0xfc9e0eefe9f3a5101b7c025b217c03c95dbf9bb4f2d1d46db238e305af104103';
  const res = [];
  const pubCommitLength = THRESHOLD * 2 + 2;
  for (let i = 0; i < pubCommitLength; i++) {
    res.push(web3.toHex(SOME_BIG_NUMBER));
  }
  return res;
}


// This should call Go code - it is just a mock here
function getPrCommit() {
  const ANOTHER_BIG_NUMBER = '0xfc9e0eefe9f3a5101b7c025b217c03c95dbf9bb4f2d1d46db238e305af104104';
  const res = [];
  const prCommitLength = CLIENT_COUNT;
  for (let i = 0; i < prCommitLength; i++) {
    res.push(web3.toHex(ANOTHER_BIG_NUMBER));
  }
  return res;
}

*/