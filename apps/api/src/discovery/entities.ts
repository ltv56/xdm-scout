import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm'
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
