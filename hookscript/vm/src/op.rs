//! Opcodes, operand sizes and the gas (CU) weight of every op.
//! The TypeScript compiler mirrors this table in compiler/src/bytecode.ts; the parity test checks both.

pub const END: u8 = 0x00;
pub const REFUSE: u8 = 0x01;
pub const REFUSEV: u8 = 0x02;
pub const JMP: u8 = 0x04;
pub const JZ: u8 = 0x05;
pub const JNZ: u8 = 0x06;
pub const POP: u8 = 0x07;
pub const DUP: u8 = 0x08;
pub const PUSHI: u8 = 0x09;
pub const PUSHR: u8 = 0x0A;
pub const LDL: u8 = 0x0B;
pub const STL: u8 = 0x0C;

pub const ADD: u8 = 0x10;
pub const SUB: u8 = 0x11;
pub const MUL: u8 = 0x12;
pub const DIV: u8 = 0x13;
pub const MOD: u8 = 0x14;
pub const NEG: u8 = 0x15;
pub const ABS: u8 = 0x16;
pub const MIN: u8 = 0x17;
pub const MAX: u8 = 0x18;
pub const MULDIV: u8 = 0x19;
pub const NOT: u8 = 0x1A;

pub const EQ: u8 = 0x20;
pub const NE: u8 = 0x21;
pub const LT: u8 = 0x22;
pub const LE: u8 = 0x23;
pub const GT: u8 = 0x24;
pub const GE: u8 = 0x25;

pub const CTX: u8 = 0x30;
pub const WAL: u8 = 0x31;
pub const WIN: u8 = 0x32;
pub const CLOCK: u8 = 0x33;
pub const DAYLIGHT: u8 = 0x34;
pub const MOON: u8 = 0x35;
pub const DECAY: u8 = 0x36;
pub const RINGTICK: u8 = 0x37;
pub const RINGAT: u8 = 0x38;

pub const LDG: u8 = 0x40;
pub const STG: u8 = 0x41;
pub const LDW: u8 = 0x42;
pub const STW: u8 = 0x43;
pub const KEQ: u8 = 0x44;
pub const KSTG: u8 = 0x45;
pub const KSTW: u8 = 0x46;

/// Gas charged for one execution of `op`, in compute units (calibrated upper bounds; see SPEC.md "Cost model").
/// `None` = not an opcode.
pub const fn gas(op: u8) -> Option<u16> {
    Some(match op {
        END | REFUSE => 40,
        REFUSEV => 45,
        JMP | JZ | JNZ => 16,
        POP | DUP => 10,
        PUSHI | PUSHR => 30,
        LDL | STL => 12,
        ADD | SUB | NEG | ABS | MIN | MAX | NOT => 14,
        EQ | NE | LT | LE | GT | GE => 14,
        MUL => 60,
        DIV | MOD | MULDIV => 160,
        CTX => 120,
        WAL => 120,
        WIN => 220,
        CLOCK => 520,
        DAYLIGHT => 700,
        MOON => 800,
        DECAY => 900,
        RINGTICK => 320,
        RINGAT => 240,
        LDG | LDW => 45,
        STG | STW => 50,
        KEQ => 90,
        KSTG | KSTW => 80,
        _ => return None,
    })
}

/// Operand bytes that follow the opcode. PUSHI/PUSHR are varints (returns None: variable).
pub const fn operand_len(op: u8) -> Option<usize> {
    Some(match op {
        END | POP | DUP | DECAY => 0,
        ADD | SUB | MUL | DIV | MOD | NEG | ABS | MIN | MAX | MULDIV | NOT => 0,
        EQ | NE | LT | LE | GT | GE => 0,
        REFUSE | REFUSEV | LDL | STL | CTX | MOON => 1,
        JMP | JZ | JNZ | WAL | WIN | LDG | STG => 2,
        LDW | STW | KSTG => 3,
        CLOCK | DAYLIGHT | KEQ | KSTW => 4,
        RINGTICK | RINGAT => 5,
        _ => return None,
    })
}

/// Number of CTX fields (0..CTX_FIELDS).
pub const CTX_FIELDS: u8 = 16;
/// Number of WAL fields.
pub const WAL_FIELDS: u8 = 14;
/// Number of CLOCK fields.
pub const CLOCK_FIELDS: u8 = 9;
/// Number of MOON fields.
pub const MOON_FIELDS: u8 = 3;

// CTX fields
pub const C_KIND: u8 = 0;
pub const C_AMOUNT: u8 = 1;
pub const C_VALUE: u8 = 2;
pub const C_SLOT: u8 = 3;
pub const C_NOW: u8 = 4;
pub const C_LAUNCH: u8 = 5;
pub const C_AGE: u8 = 6;
pub const C_LAUNCH_SLOT: u8 = 7;
pub const C_SUPPLY: u8 = 8;
pub const C_PRICE: u8 = 9;
pub const C_PROGRESS: u8 = 10;
pub const C_MCAP: u8 = 11;
pub const C_RAISED: u8 = 12;
pub const C_FEE: u8 = 13;
pub const C_SAME_WALLET: u8 = 14;
pub const C_IS_CREATOR: u8 = 15;

// WAL fields
pub const W_HAS_RECORD: u8 = 0;
pub const W_IS_POOL: u8 = 1;
pub const W_BALANCE: u8 = 2;
pub const W_BALANCE_AFTER: u8 = 3;
pub const W_FIRST_RECEIPT: u8 = 4;
pub const W_LAST_BUY_SLOT: u8 = 5;
pub const W_LAST_BUY: u8 = 6;
pub const W_LAST_SELL: u8 = 7;
pub const W_BOUGHT: u8 = 8;
pub const W_SOLD: u8 = 9;
pub const W_BUYS: u8 = 10;
pub const W_SELLS: u8 = 11;
pub const W_LAST_TRADE: u8 = 12;
pub const W_HELD: u8 = 13;

// storage types
pub const T_NUM: u8 = 0;
pub const T_INT: u8 = 1;
pub const T_TIME: u8 = 2;
pub const T_BOOL: u8 = 3;

/// Bytes a storage type occupies.
pub const fn type_size(ty: u8) -> Option<usize> {
    match ty {
        T_NUM => Some(8),
        T_INT | T_TIME => Some(4),
        T_BOOL => Some(1),
        _ => None,
    }
}

// wallet sides
pub const S_SENDER: u8 = 0;
pub const S_RECEIVER: u8 = 1;
pub const S_TRADER: u8 = 2;
pub const S_OTHER: u8 = 3;

// key ref kinds
pub const K_CTX: u8 = 0;
pub const K_CONST: u8 = 1;
pub const K_GLOBAL: u8 = 2;
pub const K_WVAR: u8 = 3; // arg low 2 bits = side, high 6 bits = offset (always 0: a key fills the 32-byte area)

// ctx key ids (K_CTX arg)
pub const KC_ZERO: u8 = 0;
pub const KC_SENDER: u8 = 1;
pub const KC_RECEIVER: u8 = 2;
pub const KC_TRADER: u8 = 3;
pub const KC_CREATOR: u8 = 4;
pub const KC_APP: u8 = 5;
pub const KC_OTHER: u8 = 6;

// header flags
pub const F_CURVE: u8 = 0x01;
pub const F_SENDER: u8 = 0x02;
pub const F_RECEIVER: u8 = 0x04;
pub const F_APP: u8 = 0x08;
pub const F_WRITES_GLOBALS: u8 = 0x10;
pub const F_WRITES_WALLET: u8 = 0x20;
pub const F_READS_GLOBALS: u8 = 0x40;
pub const F_READS_WALLET: u8 = 0x80;

/// Bytes of globals a price ring (curve.price_at) uses.
pub const RING_BYTES: usize = 48;
