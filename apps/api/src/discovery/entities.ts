import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, Unique } from 'typeorm'
import { RelationshipContext } from '../sending/entities'

@Entity('campaigns')
export class Campaign {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 128 })
  name!: string

  @Column({ type: 'json' })
  keywords!: string[]

  @Column({ type: 'json' })
  handles!: string[]

  @Column({ type: 'int', default: 1_000_000 })
  budgetMicros!: number
}

@Entity('x_posts')
export class XPost {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  postId!: string

  @Index()
  @Column({ type: 'varchar', length: 32 })
  xUserId!: string

  @Column({ type: 'text' })
  text!: string

  @Column({ type: 'datetime', precision: 3 })
  postedAt!: Date

  @Column({ type: 'datetime', precision: 3 })
  fetchedAt!: Date
}

@Entity('api_usage')
export class ApiUsage {
  @PrimaryGeneratedColumn()
  id!: number

  @Index()
  @Column()
  campaignId!: number

  @Column({ type: 'varchar', length: 16 })
  kind!: 'profile' | 'post'

  @Column({ type: 'int' })
  count!: number

  @Column({ type: 'int' })
  costMicros!: number

  @CreateDateColumn()
  createdAt!: Date
}

export type ProspectStatus = 'new' | 'shortlisted' | 'dismissed'

@Entity('prospects')
@Unique(['campaignId', 'xUserId'])
export class Prospect {
  @PrimaryGeneratedColumn()
  id!: number

  @Column()
  campaignId!: number

  @Column({ type: 'varchar', length: 32 })
  xUserId!: string

  @Column({ type: 'varchar', length: 16, default: 'cold' })
  relationship!: RelationshipContext

  @Column({ type: 'varchar', length: 16, default: 'new' })
  status!: ProspectStatus
}
