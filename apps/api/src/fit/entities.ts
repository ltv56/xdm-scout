import { Column, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm'

@Entity('evidence')
export class Evidence {
  @PrimaryColumn({ type: 'varchar', length: 48 })
  id!: string

  @Index()
  @Column({ type: 'varchar', length: 32 })
  xUserId!: string

  @Column({ type: 'varchar', length: 8 })
  kind!: 'bio' | 'post'

  @Column({ type: 'varchar', length: 255 })
  url!: string

  @Column({ type: 'text' })
  excerpt!: string

  @Column({ type: 'datetime', precision: 3, nullable: true })
  postedAt!: Date | null

  @Column({ type: 'datetime', precision: 3 })
  fetchedAt!: Date
}

export type ClaimSide = 'for' | 'against' | 'unknown'
export type ClaimStatus = 'verified' | 'inferred'

@Entity('claims')
export class Claim {
  @PrimaryGeneratedColumn()
  id!: number

  @Index()
  @Column()
  prospectId!: number

  @Column({ type: 'varchar', length: 8 })
  side!: ClaimSide

  @Column({ type: 'text' })
  text!: string

  @Column({ type: 'json' })
  evidenceIds!: string[]

  @Column({ type: 'varchar', length: 8 })
  status!: ClaimStatus
}
