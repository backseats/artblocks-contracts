import {
  BN,
  constants,
  expectEvent,
  expectRevert,
  balance,
  ether,
} from "@openzeppelin/test-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import {
  getAccounts,
  assignDefaultConstants,
  deployAndGet,
  deployCoreWithMinterFilter,
  mintProjectUntilRemaining,
  advanceEVMByTime,
} from "../../util/common";
import { FOUR_WEEKS } from "../../util/constants";

// test the following V3 core contract derivatives:
const coreContractsToTest = [
  "GenArt721CoreV3_Engine_Flex", // V3 core Engine contract
];

/**
 * General Integration tests for V3 core.
 */
for (const coreContractName of coreContractsToTest) {
  describe(`${coreContractName} Integration`, async function () {
    beforeEach(async function () {
      // standard accounts and constants
      this.accounts = await getAccounts();
      await assignDefaultConstants.call(this);

      // deploy and configure minter filter and minter
      ({
        genArt721Core: this.genArt721Core,
        minterFilter: this.minterFilter,
        randomizer: this.randomizer,
        adminACL: this.adminACL,
      } = await deployCoreWithMinterFilter.call(
        this,
        coreContractName,
        "MinterFilterV1"
      ));

      this.minter = await deployAndGet.call(this, "MinterSetPriceV2", [
        this.genArt721Core.address,
        this.minterFilter.address,
      ]);

      // add project
      await this.genArt721Core
        .connect(this.accounts.deployer)
        .addProject("name", this.accounts.artist.address);
      await this.genArt721Core
        .connect(this.accounts.deployer)
        .toggleProjectIsActive(this.projectZero);
      await this.genArt721Core
        .connect(this.accounts.artist)
        .updateProjectMaxInvocations(this.projectZero, this.maxInvocations);

      // configure minter for project zero
      await this.minterFilter
        .connect(this.accounts.deployer)
        .addApprovedMinter(this.minter.address);
      await this.minterFilter
        .connect(this.accounts.deployer)
        .setMinterForProject(this.projectZero, this.minter.address);
      await this.minter
        .connect(this.accounts.artist)
        .updatePricePerTokenInWei(this.projectZero, 0);
    });
    describe("external asset dependencies", async function () {
      it("can add an external asset dependency", async function () {
        // add external asset dependency to project 0
        await expect(
          this.genArt721Core
            .connect(this.accounts.artist)
            .addProjectExternalAssetDependency(
              this.projectZero,
              "QmbCdEwHebtpLZSRLGnELbJmmVVJQJPfMEVo1vq2QBEoEo",
              0
            )
        )
          .to.emit(this.genArt721Core, "ExternalAssetDependencyUpdated")
          .withArgs(
            0,
            0,
            "QmbCdEwHebtpLZSRLGnELbJmmVVJQJPfMEVo1vq2QBEoEo",
            0,
            1
          );
        const externalAssetDependency = await this.genArt721Core
          .connect(this.accounts.artist)
          .projectExternalAssetDependencyByIndex(0, 0);

        expect(externalAssetDependency[0]).to.equal(
          "QmbCdEwHebtpLZSRLGnELbJmmVVJQJPfMEVo1vq2QBEoEo"
        );
        expect(externalAssetDependency[1]).to.equal(0);
      });

      it("can remove an external asset dependency", async function () {
        // add assets for project 0 at index 0, 1, 2
        await this.genArt721Core
          .connect(this.accounts.artist)
          .addProjectExternalAssetDependency(
            this.projectZero,
            "QmbCdEwHebtpLZSRLGnELbJmmVVJQJPfMEVo1vq2QBEoEo",
            0
          );
        await this.genArt721Core
          .connect(this.accounts.artist)
          .addProjectExternalAssetDependency(
            this.projectZero,
            "QmbCdEwHebtpLZSRLGnELbJmmVVJQJPfMEVo1vq2QBEoEo2",
            1
          );
        await this.genArt721Core
          .connect(this.accounts.artist)
          .addProjectExternalAssetDependency(
            this.projectZero,
            "QmbCdEwHebtpLZSRLGnELbJmmVVJQJPfMEVo1vq2QBEoEo3",
            0
          );
        // remove external asset at index 1
        await this.genArt721Core
          .connect(this.accounts.artist)
          .removeProjectExternalAssetDependency(0, 1);

        // project external asset info at index 2 should be set back to default values as a result of being deleted
        const externalAssetDependency = await this.genArt721Core
          .connect(this.accounts.artist)
          .projectExternalAssetDependencyByIndex(0, 2);
        expect(externalAssetDependency[0]).to.equal("");
        expect(externalAssetDependency[1]).to.equal(0);

        // project external asset info at index 1 should be set be set to the same values as index 2, prior to removal
        // this test also validates the deepy copy of the shifted external asset dependency
        const externalAssetDependencyAtIndex1 = await this.genArt721Core
          .connect(this.accounts.artist)
          .projectExternalAssetDependencyByIndex(0, 1);
        expect(externalAssetDependencyAtIndex1[0]).to.equal(
          "QmbCdEwHebtpLZSRLGnELbJmmVVJQJPfMEVo1vq2QBEoEo3"
        );
        expect(externalAssetDependencyAtIndex1[1]).to.equal(0);

        const externalAssetDependencyCount = await this.genArt721Core
          .connect(this.accounts.artist)
          .projectExternalAssetDependencyCount(0);
        expect(externalAssetDependencyCount).to.equal(2);
      });

      it("can update an external asset dependency", async function () {
        // add assets for project 0 at index 0
        await this.genArt721Core
          .connect(this.accounts.artist)
          .addProjectExternalAssetDependency(
            this.projectZero,
            "QmbCdEwHebtpLZSRLGnELbJmmVVJQJPfMEVo1vq2QBEoEo",
            0
          );
        // get asset info at index 0 for project 0
        const externalAssetDependency = await this.genArt721Core
          .connect(this.accounts.artist)
          .projectExternalAssetDependencyByIndex(0, 0);
        expect(externalAssetDependency[0]).to.equal(
          "QmbCdEwHebtpLZSRLGnELbJmmVVJQJPfMEVo1vq2QBEoEo"
        );
        expect(externalAssetDependency[1]).to.equal(0);
        // update asset info at index 0 for project 0
        await this.genArt721Core
          .connect(this.accounts.artist)
          .updateProjectExternalAssetDependency(
            0,
            0,
            "QmbCdEwHebtpLZSRLGnELbJmmVVJQJPfMEVo1vq2QBEoEo2",
            1
          );

        const externalAssetDependency2 = await this.genArt721Core
          .connect(this.accounts.artist)
          .projectExternalAssetDependencyByIndex(0, 0);
        expect(externalAssetDependency2[0]).to.equal(
          "QmbCdEwHebtpLZSRLGnELbJmmVVJQJPfMEVo1vq2QBEoEo2"
        );
        expect(externalAssetDependency2[1]).to.equal(1);
      });

      it("can lock a projects external asset dependencies", async function () {
        // add assets for project 0 at index 0
        await this.genArt721Core
          .connect(this.accounts.artist)
          .addProjectExternalAssetDependency(
            this.projectZero,
            "QmbCdEwHebtpLZSRLGnELbJmmVVJQJPfMEVo1vq2QBEoEo",
            0
          );
        // lock external asset dependencies for project 0
        await this.genArt721Core
          .connect(this.accounts.artist)
          .lockProjectExternalAssetDependencies(0);

        // get asset info at index 0 for project 0
        const externalAssetDependency = await this.genArt721Core
          .connect(this.accounts.artist)
          .projectExternalAssetDependencyByIndex(0, 0);

        expect(externalAssetDependency[0]).to.equal(
          "QmbCdEwHebtpLZSRLGnELbJmmVVJQJPfMEVo1vq2QBEoEo"
        );
        expect(externalAssetDependency[1]).to.equal(0);

        await expectRevert(
          this.genArt721Core
            .connect(this.accounts.artist)
            .updateProjectExternalAssetDependency(
              0,
              0,
              "QmbCdEwHebtpLZSRLGnELbJmmVVJQJPfMEVo1vq2QBEoEo2",
              1
            ),
          "Project external asset dependencies are locked"
        );
      });

      it("can use projectExternalAssetDependencyCount getter", async function () {
        const externalAssetDependencyCountA = await this.genArt721Core
          .connect(this.accounts.artist)
          .projectExternalAssetDependencyCount(0);
        expect(externalAssetDependencyCountA).to.equal(0);
        // add assets for project 0 at index 0
        await this.genArt721Core
          .connect(this.accounts.artist)
          .addProjectExternalAssetDependency(
            this.projectZero,
            "QmbCdEwHebtpLZSRLGnELbJmmVVJQJPfMEVo1vq2QBEoEo",
            0
          );

        const externalAssetDependencyCountB = await this.genArt721Core
          .connect(this.accounts.artist)
          .projectExternalAssetDependencyCount(0);
        expect(externalAssetDependencyCountB).to.equal(1);
      });

      it("can update contract preferred IPFS & Arweave gateways", async function () {
        // setting IPFS gateway
        await expect(
          this.genArt721Core
            .connect(this.accounts.deployer)
            .updateIPFSGateway("https://ipfs.io/ipfs/")
        )
          .to.emit(this.genArt721Core, "GatewayUpdated")
          .withArgs(0, "https://ipfs.io/ipfs/");

        // setting Arweave gateway
        await expect(
          this.genArt721Core
            .connect(this.accounts.deployer)
            .updateArweaveGateway("https://arweave.net/")
        )
          .to.emit(this.genArt721Core, "GatewayUpdated")
          .withArgs(1, "https://arweave.net/");
      });
    });
  });
}
