const chai = require('chai');
const dirtyChai = require('dirty-chai');
const BigNumber = require('bignumber.js');
const bgls = require('../src/bglswrapper.js');

// import expectRevert from './helpers/expectRevert';

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


const {
  expect
} = chai;
chai.use(dirtyChai);

const ETH_URL = "http://127.0.0.1:7545";
const CONTRACT_ADDRESS = '0xF7d58983Dbe1c84E03a789A8A2274118CC29b5da';

const CLIENT_COUNT = 5;
const THRESHOLD = 2;
const DEPOSIT_WEI = 1000000000000000000; // 1e18

const CLIENTS = [{
  address: '0x6E0C57E9B3a8BfDe94e89105b78A7f8bc40e85A0',
  privateKey: 'a05e8bd12f53f6063feae2623273cca6f0747574c3101537ea1f5602737dc97e',
},
  {
    address: '0xc761554c5EBE2303163fdb8319c0bA5b6bAB6526',
    privateKey: '9f47537b57875335b059ad59ce1c4a02b2504158ee8df36879ef44723f364deb',
  },
  {
    address: '0xa9C4381A5f6f9C7B8d525696436184B5f8763154',
    privateKey: '16b92ef93d268d20ec5078ef17b35605e7ba800a198b6916fbdc86bfced6f060',
  },
  {
    address: '0xA590aB8FFfb627C78c1632Ea986115f0c5d9f3bd',
    privateKey: 'ebf09917aac97a881851b828ce4e3e45d7fb7071577456ea932b17ec0fa04507',
  },
  {
    address: '0x501106e7c52dBe89A8a67378A17586649E053C25',
    privateKey: '4fd18d7b4d391ffede4d2f7691de47252be47bda95f10bcfe7ee399d181a8723',
  }
];


const DKGG2 = artifacts.require('../contracts/dkgG2.sol');
let dkgContract;
let allCommitData;

contract('DKG POC', (accounts) => {
  it('should send transaction to DKG contract method join()', async () => {
    dkgContract = await DKGG2.new(THRESHOLD, CLIENT_COUNT, DEPOSIT_WEI);
    console.log(`Deployed DKG contract on address ${dkgContract.address}, txHash: ${dkgContract.transactionHash}`);
    await joinAllClients();
  });
  it('should use BGLS to calculate coefficients, G1, G2, prv data for commit()', async () => {
    allCommitData = bgls.GetCommitDataForAllParticipants(THRESHOLD, CLIENT_COUNT);
    console.log(`Commit Data: ${allCommitData}`);
  });
  it('should send transaction to DKG contract method commit()', async () => {
    await commitAllClients(allCommitData);
  });
  it('should send transaction to DKG contract method closeContract()', async () => {
    await closeContract();
  });
  it('should use BGLS to sign and verify a sample message', async () => {
    bgls.SignAndVerify(allCommitData);
  });
});

async function join(client, i) {
  console.log(`Calling join() with client #${i} ${client.address}`);
  const res = await dkgContract.join({
    from: client.address,
    value: DEPOSIT_WEI,
    gasLimit: 3000000,
  });
  console.log(`Client #${i} ${client.address} joined successfully.`);
  // console.log(`Client #${i} ${client.address} joined successfully. Result: ${JSON.stringify(res)}`);
  client.id = null;
  for (let i = 0; i < res.logs.length; i++) {
    var log = res.logs[i];

    if (log.event === "ParticipantJoined") {
      client.id = log.args.index;
      console.log(`Client #${i} received ID [${client.id}] from join()`);
      break;
    }
  }
  if (client.id === null) {
    throw new Error(`Client #${i} did not receive an ID from join(), cannot continue`);
  }
  return res;
}

async function joinAllClients() {
  console.log('=====> join <=====');
  const promises = [];
  CLIENTS.forEach((client, i) => {
    promises.push(join(client, i));
  });
  promises.push(() => {
    setTimeout(1000);
  });
  const res = await Promise.all(promises);
  return res;
}

/// Commit

async function commitAllClients(allDataBuf) {
  console.log(` =====> commit <=====`);
  const promises = [];

  const allData = JSON.parse(allDataBuf.toString());
  console.log("commitAllClients(): allData=", JSON.stringify(allData));

  const {coefsAll, commitG1All, commitG2All, commitPrvAll} = allData;

  CLIENTS.forEach((client, i) => {
    console.log(`Calling commit() with client #${i} ${client.address}`);
    promises.push(commit(client, i, coefsAll[i], commitG1All[i], commitG2All[i], commitPrvAll[i]));
  });
  promises.push(() => {
    setTimeout(1000);
  });
  const res = await Promise.all(promises);

  // Decide if we want to run VerifyPublicCommitment, VerifyPrivateCommitment here

  return res;
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

  // console.log(`Commit(): client.id=${client.id} pubCommit=${JSON.stringify(pubCommit)} prCommit=${JSON.stringify(prCommit)}`);
  console.log(`Commit(): calling with client.id=${client.id}`);
  const result = await dkgContract.commit.call(client.id, commitG1, commitG2, commitPrv, {
    from: client.address,
    gasLimit: 3000000
  });

  // TODO: Add listener to NewCommit() event
  // Each client saves the pubCommitG1 and pubCommitG2 of ALL clients (save under its sender index),
  // prCommit[] is an array of bigints (f(i))(2) for all client indexes, but generated with the current client's coeffs.


  console.log(`Commit(): Client #${i} ${client.address} committed successfully. Result: ${JSON.stringify(result)}`);
}


function closeContract() {

// TODO Client 0 to call dkgContract.phaseChange() and verify it runs. Don't send deposit.
// TODO return how much gas was spent for all calls for each client
// Separate to execution cost (function of opcodes) and transaction cost (execution cost + fixed cost per tx)


}


/*
function getCommitInputs() {
  const cmd = `${CWD}/dkgmain -func=GetCommitInputs`;
  const stdoutBuffer = execSync(cmd, {cwd: CWD});
  console.log(stdoutBuffer.toString());

}

// This should call Go code - it is just a mock here
function getPubCommitG1() {

  const SOME_BIG_NUMBER = '0xfc9e0eefe9f3a5101b7c025b217c03c95dbf9bb4f2d1d46db238e305af104103';
  const res = [];
  const pubCommitLength = THRESHOLD * 2 + 2;
  for (let i = 0; i < pubCommitLength; i++) {
    res.push(web3.toBigNumber(SOME_BIG_NUMBER));
  }
  return res;
}

function getPubCommitG2() {

  const SOME_BIG_NUMBER = '0xfc9e0eefe9f3a5101b7c025b217c03c95dbf9bb4f2d1d46db238e305af104103';
  const res = [];
  const pubCommitLength = THRESHOLD * 2 + 2;
  for (let i = 0; i < pubCommitLength; i++) {
    res.push(web3.toBigNumber(SOME_BIG_NUMBER));
  }
  return res;
}


// This should call Go code - it is just a mock here
function getPrCommit() {
  const ANOTHER_BIG_NUMBER = '0xfc9e0eefe9f3a5101b7c025b217c03c95dbf9bb4f2d1d46db238e305af104104';
  const res = [];
  const prCommitLength = CLIENT_COUNT;
  for (let i = 0; i < prCommitLength; i++) {
    res.push(web3.toBigNumber(ANOTHER_BIG_NUMBER));
  }
  return res;
}

*/