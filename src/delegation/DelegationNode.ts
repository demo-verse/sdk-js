import { SubmittableExtrinsic } from '@polkadot/api/SubmittableExtrinsic'
import { CodecResult } from '@polkadot/api/promise/types'
import { Option, Text } from '@polkadot/types'
import Crypto from '../crypto'
import Blockchain, { QueryResult } from '../blockchain/Blockchain'
import { TxStatus } from '../blockchain/TxStatus'
import { factory } from '../config/ConfigLog'
import { coToUInt8, u8aConcat, u8aToHex } from '../crypto/Crypto'
import Identity from '../identity/Identity'
import { IPublicIdentity } from '../identity/PublicIdentity'
import {
  DelegationBaseNode,
  IDelegationBaseNode,
  IDelegationNode,
  IDelegationRootNode,
  Permission,
} from './Delegation'
import { decodeDelegationNode } from './DelegationDecoder'
import { DelegationRootNode } from './DelegationRootNode'

const log = factory.getLogger('DelegationNode')

export class DelegationNode extends DelegationBaseNode
  implements IDelegationNode {
  public static async query(
    blockchain: Blockchain,
    delegationId: IDelegationBaseNode['id']
  ): Promise<IDelegationNode | undefined> {
    log.info(`:: query('${delegationId}')`)
    const decoded: IDelegationNode | undefined = decodeDelegationNode(
      await blockchain.api.query.delegation.delegations(delegationId)
    )
    if (decoded) {
      decoded.id = delegationId
    }
    log.info(`result: ${JSON.stringify(decoded)}`)
    return decoded
  }

  public rootId: IDelegationBaseNode['id']
  public parentId?: IDelegationBaseNode['id']
  public permissions: Permission[]

  constructor(
    id: IDelegationBaseNode['id'],
    rootId: IDelegationBaseNode['id'],
    account: IPublicIdentity['address'],
    permissions: Permission[],
    parentId?: IDelegationBaseNode['id']
  ) {
    super(id, account)
    this.permissions = permissions
    this.rootId = rootId
    this.parentId = parentId
  }

  public generateHash(): string {
    const propsToHash: Array<Uint8Array | string> = [this.id, this.rootId]
    if (this.parentId && this.parentId !== this.rootId) {
      propsToHash.push(this.parentId)
    }
    const uint8Props: Uint8Array[] = propsToHash.map(value => {
      return coToUInt8(value)
    })
    uint8Props.push(this.permissionsAsBitset())
    const generated: string = u8aToHex(
      Crypto.hash(u8aConcat(...uint8Props), 256)
    )
    log.debug(`generateHash(): ${generated}`)
    return generated
  }

  public async getRoot(blockchain: Blockchain): Promise<IDelegationRootNode> {
    const rootNode:
      | IDelegationRootNode
      | undefined = await DelegationRootNode.query(blockchain, this.rootId)
    if (!rootNode) {
      throw new Error(`Could not find root node with id ${this.rootId}`)
    }
    return rootNode as IDelegationRootNode
  }

  public async getParent(
    blockchain: Blockchain
  ): Promise<IDelegationBaseNode | undefined> {
    if (!this.parentId) {
      // parent must be root
      return await this.getRoot(blockchain)
    }
    return await DelegationNode.query(blockchain, this.parentId)
  }

  public async store(
    blockchain: Blockchain,
    identity: Identity,
    signature: string
  ): Promise<TxStatus> {
    log.info(`:: store(${this.id})`)
    const includeParentId: boolean = this.parentId
      ? this.parentId !== this.rootId
      : false
    const tx: SubmittableExtrinsic<
      CodecResult,
      any
    > = await blockchain.api.tx.delegation.addDelegation(
      this.id,
      this.rootId,
      new Option(Text, includeParentId ? this.parentId : undefined),
      this.account,
      this.permissionsAsBitset(),
      signature
    )
    return blockchain.submitTx(identity, tx)
  }

  public async verify(blockchain: Blockchain): Promise<boolean> {
    const node: IDelegationNode | undefined = await DelegationNode.query(
      blockchain,
      this.id
    )
    return node !== undefined && !node.revoked
  }

  public async revoke(
    blockchain: Blockchain,
    identity: Identity
  ): Promise<TxStatus> {
    log.debug(`:: revoke(${this.id})`)
    const tx: SubmittableExtrinsic<
      CodecResult,
      any
    > = await blockchain.api.tx.delegation.revokeDelegation(this.id)
    return blockchain.submitTx(identity, tx)
  }

  protected decodeChildNode(
    queryResult: QueryResult
  ): IDelegationNode | undefined {
    return decodeDelegationNode(queryResult)
  }

  /**
   * Creates a bitset from the permissions in the array where each enum value
   * is used to set the bit flag in the set.
   *
   * ATTEST has `0000000000000001`  (decimal 1)
   * DELEGATE has `0000000000000010` (decimal 2)
   *
   * Adding the enum values results in a decimal representation of the bitset.
   *
   * @returns the bitset as single value uint8 array
   */
  private permissionsAsBitset(): Uint8Array {
    const permisssionsAsBitset: number = this.permissions.reduce(
      (accumulator, currentValue) => accumulator + currentValue
    )
    const uint8: Uint8Array = new Uint8Array(4)
    uint8[0] = permisssionsAsBitset
    return uint8
  }
}