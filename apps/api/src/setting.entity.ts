import { Column, Entity, PrimaryColumn } from 'typeorm'

@Entity('settings')
export class Setting {
  @PrimaryColumn({ type: 'varchar', length: 191 })
  key!: string

  @Column({ type: 'json' })
  value!: unknown
}
