import { constants, expectRevert } from "@openzeppelin/test-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber } from "ethers";

import EthersAdapter from "@gnosis.pm/safe-ethers-lib";
import Safe from "@gnosis.pm/safe-core-sdk";
import { SafeTransactionDataPartial } from "@gnosis.pm/safe-core-sdk-types";
import { getGnosisSafe } from "../../util/GnosisSafeNetwork";
import { isCoreV3, deployAndGet } from "../../util/common";
import { completeAuctionWithoutSellingOut } from "./MinterDAExpSettlement/MinterDAExpSettlement.common";

/**
 * These tests are intended to check common DA w/Settlement V1 functionality.
 * The tests are intended to be run on the any DA Settlement V1 contract; for
 * example, if a linear DA Settlement were to be created, these tests would
 * be applicable to that contract.
 * @dev assumes common BeforeEach to populate accounts, constants, and setup
 * @dev does not call specific type of DA Settlement common tests.
 */
export const MinterDASettlementV1V2_Common = async () => {
  describe("purchase_H4M", async function () {
    it("allows `purchase_H4M` by default", async function () {
      await ethers.provider.send("evm_mine", [
        this.startTime + this.auctionStartTimeOffset,
      ]);
      await this.minter
        .connect(this.accounts.user)
        .purchase_H4M(this.projectZero, {
          value: this.startingPrice,
        });
    });

    describe("payment splitting", async function () {
      beforeEach(async function () {
        this.deadReceiver = await deployAndGet.call(
          this,
          "DeadReceiverMock",
          []
        );
      });

      it("requires successful payment to render provider", async function () {
        // achieve a state that splits revenues at time of sale
        await completeAuctionWithoutSellingOut.call(this, this.projectZero);
        // update render provider address to a contract that reverts on receive
        // call appropriate core function to update render provider address
        if (this.isEngine) {
          await this.genArt721Core
            .connect(this.accounts.deployer)
            .updateProviderSalesAddresses(
              this.deadReceiver.address,
              this.accounts.additional.address,
              this.accounts.artist2.address,
              this.accounts.additional2.address
            );
        } else {
          await this.genArt721Core
            .connect(this.accounts.deployer)
            .updateArtblocksPrimarySalesAddress(this.deadReceiver.address);
        }
        // expect revert when trying to purchase
        await expectRevert(
          this.minter
            .connect(this.accounts.user)
            .purchaseTo(this.accounts.additional.address, this.projectZero, {
              value: this.startingPrice,
            }),
          "Render Provider payment failed"
        );
      });

      it("requires successful payment to platform provider", async function () {
        // only relevant for engine core contracts
        if (!this.isEngine) {
          console.log("skipping test for non-engine contract");
          return;
        }
        // achieve a state that splits revenues at time of sale
        await completeAuctionWithoutSellingOut.call(this, this.projectZero);
        // update render provider address to a contract that reverts on receive
        await this.genArt721Core
          .connect(this.accounts.deployer)
          .updateProviderSalesAddresses(
            this.accounts.artist.address,
            this.accounts.additional.address,
            this.deadReceiver.address,
            this.accounts.additional2.address
          );
        // expect revert when trying to purchase
        await expectRevert(
          this.minter
            .connect(this.accounts.user)
            .purchaseTo(this.accounts.additional.address, this.projectZero, {
              value: this.startingPrice,
            }),
          "Platform Provider payment failed"
        );
      });

      it("requires successful payment to artist", async function () {
        // achieve a state that splits revenues at time of sale
        await completeAuctionWithoutSellingOut.call(this, this.projectZero);
        // update artist address to a contract that reverts on receive
        await this.genArt721Core
          .connect(this.accounts.deployer)
          .updateProjectArtistAddress(
            this.projectZero,
            this.deadReceiver.address
          );
        // expect revert when trying to purchase
        await expectRevert(
          this.minter
            .connect(this.accounts.user)
            .purchaseTo(this.accounts.additional.address, this.projectZero, {
              value: this.startingPrice,
            }),
          "Artist payment failed"
        );
      });

      it("requires successful payment to artist additional payee", async function () {
        // achieve a state that splits revenues at time of sale
        await completeAuctionWithoutSellingOut.call(this, this.projectZero);
        // update artist additional payee to a contract that reverts on receive
        const proposedAddressesAndSplits = [
          this.projectZero,
          this.accounts.artist.address,
          this.deadReceiver.address,
          // @dev 50% to additional, 50% to artist, to ensure additional is paid
          50,
          this.accounts.additional2.address,
          // @dev split for secondary sales doesn't matter for this test
          50,
        ];
        await this.genArt721Core
          .connect(this.accounts.artist)
          .proposeArtistPaymentAddressesAndSplits(
            ...proposedAddressesAndSplits
          );
        await this.genArt721Core
          .connect(this.accounts.deployer)
          .adminAcceptArtistAddressesAndSplits(...proposedAddressesAndSplits);
        // expect revert when trying to purchase
        await expectRevert(
          this.minter
            .connect(this.accounts.user)
            .purchaseTo(this.accounts.additional.address, this.projectZero, {
              value: this.startingPrice,
            }),
          "Additional Payee payment failed"
        );
      });

      it("registers success when sending payment to valid artist additional payee", async function () {
        // achieve a state that splits revenues at time of sale
        await completeAuctionWithoutSellingOut.call(this, this.projectZero);
        // update artist additional payee to a contract that reverts on receive
        const proposedAddressesAndSplits = [
          this.projectZero,
          this.accounts.artist.address,
          this.accounts.additional.address,
          // @dev 50% to additional, 50% to artist, to ensure additional is paid
          50,
          this.accounts.additional2.address,
          // @dev split for secondary sales doesn't matter for this test
          50,
        ];
        await this.genArt721Core
          .connect(this.accounts.artist)
          .proposeArtistPaymentAddressesAndSplits(
            ...proposedAddressesAndSplits
          );
        await this.genArt721Core
          .connect(this.accounts.deployer)
          .adminAcceptArtistAddressesAndSplits(...proposedAddressesAndSplits);
        // expect success when purchasing
        await this.minter
          .connect(this.accounts.user)
          .purchaseTo(this.accounts.additional.address, this.projectZero, {
            value: this.startingPrice,
          });
      });

      it("handles zero platform and artist payment values", async function () {
        // update platform address to zero
        // route to appropriate core function
        if (this.isEngine) {
          await this.genArt721Core
            .connect(this.accounts.deployer)
            .updateProviderPrimarySalesPercentages(0, 0);
        } else {
          await this.genArt721Core
            .connect(this.accounts.deployer)
            .updateArtblocksPrimarySalesPercentage(0);
        }
        // update artist primary split to zero
        const proposedAddressesAndSplits = [
          this.projectZero,
          this.accounts.artist.address,
          this.accounts.additional.address,
          // @dev 100% to additional, 0% to artist
          100,
          this.accounts.additional2.address,
          // @dev split for secondary sales doesn't matter for this test
          50,
        ];
        await this.genArt721Core
          .connect(this.accounts.artist)
          .proposeArtistPaymentAddressesAndSplits(
            ...proposedAddressesAndSplits
          );
        await this.genArt721Core
          .connect(this.accounts.deployer)
          .adminAcceptArtistAddressesAndSplits(...proposedAddressesAndSplits);
        // expect successful purchase
        await ethers.provider.send("evm_mine", [
          this.startTime + this.auctionStartTimeOffset,
        ]);
        await this.minter
          .connect(this.accounts.user)
          .purchaseTo(this.accounts.additional.address, this.projectZero, {
            value: this.startingPrice,
          });
      });
    });
  });

  describe("additional payee payments", async function () {
    it("handles additional payee payments", async function () {
      const valuesToUpdateTo = [
        this.projectZero,
        this.accounts.artist2.address,
        this.accounts.additional.address,
        50,
        this.accounts.additional2.address,
        51,
      ];
      await this.genArt721Core
        .connect(this.accounts.artist)
        .proposeArtistPaymentAddressesAndSplits(...valuesToUpdateTo);
      await this.genArt721Core
        .connect(this.accounts.deployer)
        .adminAcceptArtistAddressesAndSplits(...valuesToUpdateTo);

      await ethers.provider.send("evm_mine", [
        this.startTime + this.auctionStartTimeOffset,
      ]);
      await this.minter.connect(this.accounts.user).purchase(this.projectZero, {
        value: this.startingPrice,
      });
    });
  });

  describe("purchaseTo", async function () {
    it("allows `purchaseTo` by default", async function () {
      await ethers.provider.send("evm_mine", [
        this.startTime + this.auctionStartTimeOffset,
      ]);
      await this.minter
        .connect(this.accounts.user)
        .purchaseTo(this.accounts.additional.address, this.projectZero, {
          value: this.startingPrice,
        });
    });

    it("does not support toggling of `purchaseToDisabled`", async function () {
      await expectRevert(
        this.minter
          .connect(this.accounts.artist)
          .togglePurchaseToDisabled(this.projectZero),
        "Action not supported"
      );
      // still allows `purchaseTo`.
      await ethers.provider.send("evm_mine", [
        this.startTime + this.auctionStartTimeOffset,
      ]);
      await this.minter
        .connect(this.accounts.user)
        .purchaseTo(this.accounts.artist.address, this.projectZero, {
          value: this.startingPrice,
        });
    });

    it("doesn't support `purchaseTo` toggling", async function () {
      await expectRevert(
        this.minter
          .connect(this.accounts.artist)
          .togglePurchaseToDisabled(this.projectZero),
        "Action not supported"
      );
    });
  });

  describe("reentrancy attack", async function () {
    it("does not allow reentrant purchaseTo", async function () {
      // achieve a state that splits revenues at time of sale.
      await completeAuctionWithoutSellingOut.call(this, this.projectZero);
      // attacker is must be priviliged artist or admin, making this a somewhat
      // silly reentrancy attack. Still worth testing to ensure nonReentrant
      // modifier is working.
      const reentrancyMockFactory = await ethers.getContractFactory(
        "ReentrancyMock"
      );
      const reentrancyMock = await reentrancyMockFactory
        .connect(this.accounts.deployer)
        .deploy();
      // update platform payment address to the reentrancy mock contract
      // route to appropriate core function
      if (this.isEngine) {
        await this.genArt721Core
          .connect(this.accounts.deployer)
          .updateProviderSalesAddresses(
            reentrancyMock.address,
            this.accounts.user.address,
            this.accounts.additional.address,
            this.accounts.additional2.address
          );
      } else {
        await this.genArt721Core
          .connect(this.accounts.deployer)
          .updateArtblocksPrimarySalesAddress(reentrancyMock.address);
      }
      // attacker should see revert when performing reentrancy attack
      const totalTokensToMint = 2;
      let numTokensToMint = BigNumber.from(totalTokensToMint.toString());
      let totalValue = this.higherPricePerTokenInWei.mul(numTokensToMint);
      await expectRevert(
        reentrancyMock
          .connect(this.accounts.deployer)
          .attack(
            numTokensToMint,
            this.minter.address,
            this.projectZero,
            this.higherPricePerTokenInWei,
            {
              value: totalValue,
            }
          ),
        // failure message occurs during payment to render provider, where reentrency
        // attack occurs
        "Render Provider payment failed"
      );
      // attacker should be able to purchase ONE token at a time w/settlements
      numTokensToMint = BigNumber.from("1");
      totalValue = this.higherPricePerTokenInWei.mul(numTokensToMint);
      for (let i = 0; i < totalTokensToMint; i++) {
        await reentrancyMock
          .connect(this.accounts.deployer)
          .attack(
            numTokensToMint,
            this.minter.address,
            this.projectZero,
            this.higherPricePerTokenInWei,
            {
              value: this.higherPricePerTokenInWei,
            }
          );
      }
    });
  });

  describe("gnosis safe", async function () {
    it("allows gnosis safe to purchase in ETH", async function () {
      // advance to time when auction is active
      await ethers.provider.send("evm_mine", [
        this.startTime + this.auctionStartTimeOffset,
      ]);

      // deploy new Gnosis Safe
      const safeSdk: Safe = await getGnosisSafe(
        this.accounts.artist,
        this.accounts.additional,
        this.accounts.user
      );
      const safeAddress = safeSdk.getAddress();

      // create a transaction
      const unsignedTx = await this.minter.populateTransaction.purchase(
        this.projectZero
      );
      const transaction: SafeTransactionDataPartial = {
        to: this.minter.address,
        data: unsignedTx.data,
        value: this.higherPricePerTokenInWei.toHexString(),
      };
      const safeTransaction = await safeSdk.createTransaction(transaction);

      // signers sign and execute the transaction
      // artist signs
      await safeSdk.signTransaction(safeTransaction);
      // additional signs
      const ethAdapterOwner2 = new EthersAdapter({
        ethers,
        signer: this.accounts.additional,
      });
      const safeSdk2 = await safeSdk.connect({
        ethAdapter: ethAdapterOwner2,
        safeAddress,
      });
      const txHash = await safeSdk2.getTransactionHash(safeTransaction);
      const approveTxResponse = await safeSdk2.approveTransactionHash(txHash);
      await approveTxResponse.transactionResponse?.wait();

      // fund the safe and execute transaction
      await this.accounts.artist.sendTransaction({
        to: safeAddress,
        value: this.higherPricePerTokenInWei,
      });
      const viewFunctionWithInvocations = (await isCoreV3(this.genArt721Core))
        ? this.genArt721Core.projectStateData
        : this.genArt721Core.projectTokenInfo;
      const projectStateDataBefore = await viewFunctionWithInvocations(
        this.projectZero
      );
      const executeTxResponse = await safeSdk2.executeTransaction(
        safeTransaction
      );
      await executeTxResponse.transactionResponse?.wait();
      const projectStateDataAfter = await viewFunctionWithInvocations(
        this.projectZero
      );
      expect(projectStateDataAfter.invocations).to.be.equal(
        projectStateDataBefore.invocations.add(1)
      );
    });
  });
};
