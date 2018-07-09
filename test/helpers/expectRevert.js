const expectRevert = async (promise) => {
  try {
    await promise;
  } catch (error) {
    const invalidOpcode = error.message.search('invalid opcode') > -1;
    const revert = error.message.search('revert') > -1;
    const outOfGas = error.message.search('out of gas') > -1;

    assert(invalidOpcode || revert || outOfGas, `Expected revert, got ${error} instead`);

    return;
  }

  assert(false, "Expected revert wasn't received");
};

export default expectRevert;
