// SPDX-License-Identifier: LGPL-3.0-only
// Created By: Art Blocks Inc.

pragma solidity ^0.8.0;

/**
 * @title Art Blocks Script Storage Library
 * @notice Utilize contract bytecode as persistant storage for large chunks of script string data.
 *
 * @author Art Blocks Inc.
 * @author Modified from 0xSequence (https://github.com/0xsequence/sstore2/blob/master/contracts/SSTORE2.sol)
 * @author Modified from Solmate (https://github.com/transmissions11/solmate/blob/main/src/utils/SSTORE2.sol)
 *
 * @dev Compared to the above two rerferenced libraries, this contracts-as-storage implementation makes a few
 *      notably different design decisions:
 *      - uses the `string` data type for input/output on reads, rather than speaking in bytes directly
 *      - exposes "delete" functionality, allowing no-longer-used storage to be purged from chain state
 *      - stores the "writer" address (library user) in the deployed contract bytes, which is useful for both:
 *         a) providing necessary information for safe deletion; and
 *         b) allowing this to be introspected on-chain
 *      Also, given that much of this library is written in assembly, this library makes use of a slightly
 *      different convention (when compared to the rest of the Art Blocks smart contract repo) around
 *      pre-defining return values in order to simplify need to directly memory manage these return values.
 */
library BytecodeStorage {
    //---------------------------------------------------------------------------------------------------------------//
    // Starting Index | Size | Ending Index | Description                                                            //
    //---------------------------------------------------------------------------------------------------------------//
    // 0              | N/A  | 0            |                                                                        //
    // 0              | 53   | 53           | the bytes of the gated-cleanup-logic allowing for `selfdestruct`ion    //
    // 53             | 20   | 73           | the 20 bytes used for storing the deploying contract's address         //
    //---------------------------------------------------------------------------------------------------------------//
    // Define the offset for where the "logic bytes" end, and the "data bytes" begin. Note that this is a manually
    // calculated value, and must be updated if the above table is changed. It is expected that tests will fail if
    // this value is not updated.
    uint256 internal constant DATA_OFFSET = 73;

    /*//////////////////////////////////////////////////////////////
                           WRITE LOGIC
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Write a string to contract bytecode
     * @param _data string to be written to contract
     * @return address_ address of deployed contract with bytecode containing concat(gated-cleanup-logic, data)
     */
    function writeToBytecode(string memory _data)
        internal
        returns (address address_)
    {
        // prefix bytecode with
        bytes memory creationCode = abi.encodePacked(
            //---------------------------------------------------------------------------------------------------------------//
            // Opcode  | Opcode + Arguments  | Description  | Stack View                                                     //
            //---------------------------------------------------------------------------------------------------------------//
            // (0) creation code returns all code in the contract except for the first 11 (0B in hex) bytes, as these 11
            //     bytes are the creation code itself which we do not want to store in the deployed storage contract result
            //---------------------------------------------------------------------------------------------------------------//
            // 0x60    |  0x60_0B            | PUSH1 11     | codeOffset                                                     //
            // 0x59    |  0x59               | MSIZE        | 0 codeOffset                                                   //
            // 0x81    |  0x81               | DUP2         | codeOffset 0 codeOffset                                        //
            // 0x38    |  0x38               | CODESIZE     | codeSize codeOffset 0 codeOffset                               //
            // 0x03    |  0x03               | SUB          | (codeSize - codeOffset) 0 codeOffset                           //
            // 0x80    |  0x80               | DUP          | (codeSize - codeOffset) (codeSize - codeOffset) 0 codeOffset   //
            // 0x92    |  0x92               | SWAP3        | codeOffset (codeSize - codeOffset) 0 (codeSize - codeOffset)   //
            // 0x59    |  0x59               | MSIZE        | 0 codeOffset (codeSize - codeOffset) 0 (codeSize - codeOffset) //
            // 0x39    |  0x39               | CODECOPY     | 0 (codeSize - codeOffset)                                      //
            // 0xf3    |  0xf3               | RETURN       |                                                                //
            //---------------------------------------------------------------------------------------------------------------//
            hex"60_0B_59_81_38_03_80_92_59_39_F3",
            //---------------------------------------------------------------------------------------------------------------//
            // Opcode  | Opcode + Arguments  | Description  | Stack View                                                     //
            //---------------------------------------------------------------------------------------------------------------//
            // (1a) conditional logic for determing purge-gate (only the bytecode contract deployer can `selfdestruct`)
            //---------------------------------------------------------------------------------------------------------------//
            // 0x60    |  0x60_14            | PUSH1 20     | 20                                                             //
            // 0x60    |  0x60_35            | PUSH1 53 (*) | contractOffset 20                                              //
            // 0x60    |  0x60_0C            | PUSH1 12     | 12 contractOffset 20                                           //
            // 0x39    |  0x39               | CODECOPY     |                                                                //
            // 0x33    |  0x33               | CALLER       | msg.sender                                                     //
            // 0x60    |  0x60_20            | PUSH1 32     | 32 msg.sender                                                  //
            // 0x52    |  0x52               | MSTORE       |                                                                //
            // 0x60    |  0x60_00            | PUSH1 0      | 0                                                              //
            // 0x51    |  0x51               | MLOAD        | byteDeployerAddress                                            //
            // 0x60    |  0x60_20            | PUSH1 32     | 32 byteDeployerAddress                                         //
            // 0x51    |  0x51               | MLOAD        | msg.sender byteDeployerAddress                                 //
            // 0x14    |  0x14               | EQ           | (msg.sender == byteDeployerAddress)                            //
            hex"60_14_60_35_60_0C_39_33_60_20_52_60_00_51_60_20_51_14",
            //---------------------------------------------------------------------------------------------------------------//
            // (1b) load up the destination jump address for `(2a) calldata length check` logic, jump or raise `invalid` op-code
            //---------------------------------------------------------------------------------------------------------------//
            // 0x60    |  0x60_16            | PUSH1 22 (^) | jumpDestination (msg.sender == byteDeployerAddress)            //
            // 0x57    |  0x57               | JUMPI        |                                                                //
            // 0xFE    |  0xFE               | INVALID      |                                                                //
            hex"60_16_57_FE",
            //---------------------------------------------------------------------------------------------------------------//
            // (2a) conditional logic for determing purge-gate (only if calldata length is 1 byte)
            //---------------------------------------------------------------------------------------------------------------//
            // 0x5B    |  0x5B               | JUMPDEST (22)|                                                                //
            // 0x60    |  0x60_01            | PUSH1 1      | 1                                                              //
            // 0x36    |  0x36               | CALLDATASIZE | calldataSize 1                                                 //
            // 0x14    |  0x14               | EQ           | (calldataSize == 1)                                            //
            hex"5B_60_01_36_14",
            //---------------------------------------------------------------------------------------------------------------//
            // (2b) load up the destination jump address for `(3a) calldata value check` logic, jump or raise `invalid` op-code
            //---------------------------------------------------------------------------------------------------------------//
            // 0x60    |  0x60_1F            | PUSH1 31 (^) | jumpDestination (calldataSize == 1)                            //
            // 0x57    |  0x57               | JUMPI        |                                                                //
            // 0xFE    |  0xFE               | INVALID      |                                                                //
            hex"60_1F_57_FE",
            //---------------------------------------------------------------------------------------------------------------//
            // (3a) conditional logic for determing purge-gate (only if calldata is `0xFF`)
            //---------------------------------------------------------------------------------------------------------------//
            // 0x5B    |  0x5B               | JUMPDEST (31)|                                                                //
            // 0x60    |  0x60_FF            | PUSH1 0xFF   | 0xFF                                                           //
            // 0x60    |  0x60_41            | PUSH1 65     | (64+1) 0xFF                                                    //
            // 0x52    |  0x52               | MSTORE       |                                                                //
            // 0x60    |  0x60_00            | PUSH1 0      | 0                                                              //
            // 0x35    |  0x35               | CALLDATALOAD | calldata                                                       //
            // 0x60    |  0x60_60            | PUSH1 96     | 96 calldata                                                    //
            // 0x51    |  0x51               | MLOAD        | 0xFF00...00 calldata                                           //
            // 0x14    |  0x14               | EQ           | (0xFF00...00 == calldata)                                      //
            hex"5B_60_FF_60_41_52_60_00_35_60_60_51_14",
            //---------------------------------------------------------------------------------------------------------------//
            // (3b) load up the destination jump address for actual purging (4), jump or raise `invalid` op-code
            //---------------------------------------------------------------------------------------------------------------//
            // 0x60    |  0x60_30            | PUSH1 48 (^) | jumpDestination (0xFF00...00 == calldata)                      //
            // 0x57    |  0x57               | JUMPI        |                                                                //
            // 0xFE    |  0xFE               | INVALID      |                                                                //
            hex"60_30_57_FE",
            //---------------------------------------------------------------------------------------------------------------//
            //---------------------------------------------------------------------------------------------------------------//
            // (4) perform actual purging
            //---------------------------------------------------------------------------------------------------------------//
            // 0x5B    |  0x5B               | JUMPDEST (48)|                                                                //
            // 0x60    |  0x60_00            | PUSH1 0      | 0                                                              //
            // 0x51    |  0x51               | MLOAD        | byteDeployerAddress                                            //
            // 0xFF    |  0xFF               | SELFDESTRUCT |                                                                //
            hex"5B_60_00_51_FF",
            //---------------------------------------------------------------------------------------------------------------//
            // (*) Note: this value must be adjusted if selfdestruct purge logic is adjusted, to refer to the correct start  //
            //           offset for where the `msg.sender` address was stored in deplyed bytecode.                           //
            //                                                                                                               //
            // (^) Note: this value must be adjusted if portions of the selfdestruct purge logic are adjusted.               //
            //---------------------------------------------------------------------------------------------------------------//
            //
            // store the deploying-contract's address (to be used to gate and call `selfdestruct`)
            //
            // note: it is important that this address is the executing contract's address
            //      (the address that represents the client-application smart contract of this library)
            //      which means that it is the responsibility of the client-application smart contract
            //      to determine how deletes are gated (or if they are exposed at all) as it is only
            //      this contract that will be able to call `purgeBytecode` as the `CALLER` that is
            //      checked above (op-code 0x33).
            //
            // also note: abi.encodePacked will not `0`-pad the address to 32 bytes,
            //            making the address 20 bytes instead
            address(this),
            // uploaded data (stored as bytecode) comes last
            _data
        );

        assembly {
            // deploy a new contract with the generated creation code.
            // start 32 bytes into creationCode to avoid copying the byte length.
            address_ := create(0, add(creationCode, 0x20), mload(creationCode))
        }

        // address must be non-zero if contract was deployed successfully
        require(address_ != address(0), "ContractAsStorage: Write Error");
    }

    /*//////////////////////////////////////////////////////////////
                               READ LOGIC
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Read a string from contract bytecode
     * @param _address address of deployed contract with bytecode containing concat(gated-cleanup-logic, data)
     * @return data string read from contract bytecode
     */
    function readFromBytecode(address _address)
        internal
        view
        returns (string memory data)
    {
        // get the size of the bytecode
        uint256 bytecodeSize = _bytecodeSizeAt(_address);
        // handle case where address contains code < DATA_OFFSET
        // note: the first check here also captures the case where bytecodeSize == 0
        //       implicitly, but we add the second check of (bytecodeSize == 0)
        //       as a fall-through that will never execute unless `DATA_OFFSET`
        //       is set to 0 at some point.
        if ((bytecodeSize < DATA_OFFSET) || (bytecodeSize == 0)) {
            revert("ContractAsStorage: Read Error");
        }
        // handle case where address contains code >= DATA_OFFSET
        // decrement by DATA_OFFSET to account for purge logic
        uint256 size;
        unchecked {
            size = bytecodeSize - DATA_OFFSET;
        }

        assembly {
            // allocate free memory
            data := mload(0x40)
            // update free memory pointer
            // use and(x, not(0x1f) as cheaper equivalent to sub(x, mod(x, 0x20)).
            // adding 0x1f to size + logic above ensures the free memory pointer
            // remains word-aligned, following the Solidity convention.
            mstore(0x40, add(data, and(add(add(size, 0x20), 0x1f), not(0x1f))))
            // store length of data in first 32 bytes
            mstore(data, size)
            // copy code to memory, excluding the gated-cleanup-logic
            extcodecopy(_address, add(data, 0x20), DATA_OFFSET, size)
        }
    }

    /*//////////////////////////////////////////////////////////////
                              DELETE LOGIC
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Purge contract bytecode for cleanup purposes
     * @param _address address of deployed contract with bytecode containing concat(gated-cleanup-logic, data)
     * @dev This contract is only callable by the address of the contract that originally deployed the bytecode
     *      being purged. If this method is called by any other address, it will revert with the `INVALID` op-code.
     *      Additionally, for security purposes, the contract must be called with calldata `0xFF` to ensure that
     *      the `selfdestruct` op-code is intentionally being invoked, otherwise the `INVALID` op-code will be raised.
     */
    function purgeBytecode(address _address) internal {
        // deployed bytecode (above) handles all logic for purging state, so no
        // call data is expected to be passed along to perform data purge
        (
            bool success, /*` data` not needed */

        ) = _address.call(hex"FF");
        if (!success) {
            revert();
        }
    }

    /*//////////////////////////////////////////////////////////////
                          INTERNAL HELPER LOGIC
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Returns the size of the bytecode at address `_address`
        @param _address address that may or may not contain bytecode
        @return size size of the bytecode code at `_address`
    */
    function _bytecodeSizeAt(address _address)
        private
        view
        returns (uint256 size)
    {
        assembly {
            size := extcodesize(_address)
        }
    }
}