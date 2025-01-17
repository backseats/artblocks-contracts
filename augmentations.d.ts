/**
 * @dev this augments the mocha context to include some common properties
 * we use in our tests
 */
import { BigNumber } from "ethers";
import { TestAccountsArtBlocks } from "./test/util/common";

declare module "mocha" {
  export interface Context {
    accounts: TestAccountsArtBlocks;
    name: string;
    symbol: string;
    pricePerTokenInWei: BigNumber;
    maxInvocations: number;
    // project IDs
    projectZero: number;
    projectOne: number;
    projectTwo: number;
    projectThree: number;
    // token IDs
    projectZeroTokenZero: BigNumber;
    projectZeroTokenOne: BigNumber;
    projectOneTokenZero: BigNumber;
    projectOneTokenOne: BigNumber;
    projectTwoTokenZero: BigNumber;
    projectTwoTokenOne: BigNumber;
    projectThreeTokenZero: BigNumber;
    projectThreeTokenOne: BigNumber;
    // target minter name (e.g. "MinterMerkleV3")
    targetMinterName: string | undefined;
  }
}
