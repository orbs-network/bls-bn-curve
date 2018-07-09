pragma solidity 0.4.24;


contract Greeter {
    string public greeting;

    constructor(string _greeting) public {
        setGreeting(_greeting);
    }

    function setGreeting(string _greeting) public {
        greeting = _greeting;
    }
}
