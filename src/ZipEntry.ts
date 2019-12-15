import { HEADER_CD, HEADER_LOCAL } from "./constants.js";
import { encode_utf8_string } from "./string.js";
import { decompress } from "./compression.js";
import { assert } from "./assert.js";
import { dos_time_from_date } from "./dos_time.js";

const ZIP_VERSION = 20;
const inflated_entries: WeakMap<Blob, Blob> = new WeakMap

export class ZipEntry {
	private readonly blob: Blob
	private extra?: Uint8Array
	private comment?: Uint8Array
	
	internal_file_attr: number = 0
	external_file_attr: number = 0
	modified: Date = new Date
	
	readonly crc: number
	readonly uncompressed_size: number
	readonly compression: number

	get is_compressed (): boolean {
		return this.compression !== 0;
	}
	
	constructor (blob: Blob, compression_type: number, size: number, crc: number) {
		this.compression = compression_type;
		this.blob = blob;
		this.uncompressed_size = size;
		this.crc = crc;
	}

	// alias for uncompressed_size
	get size (): number {
		return this.uncompressed_size;
	}

	get compressed_size (): number {
		return this.blob.size;
	}
	
    private async decompress(): Promise<Blob> {
        const existing = inflated_entries.get(this.blob);
		if (existing)
			return existing;
		else {
			const result = await decompress(this.blob);
			inflated_entries.set(this.blob, result);
            return result;
		}
    }
    
    generate_local (filename: string): ArrayBuffer {
		const encoded_filename = encode_utf8_string(filename);
		const N = encoded_filename.length;
		const M = this.extra ? this.extra.length : 0;
		const length = 30 + N + M;
		const buffer = new ArrayBuffer(length);
		const view = new DataView(buffer);
		const uintview = new Uint8Array(buffer);

		const [date, time] = dos_time_from_date(this.modified);

		/*
		 *	4 bytes - Local file header signature
		 *	2 bytes - Minimum require version
		 *	2 bytes - Bit flag
		 *	2 bytes - Compression method
		 *  2 bytes - Last modified time
		 *  2 bytes - Last modified date
		 *  4 bytes - CRC
		 *  4 bytes - Compressed size
		 *  4 bytes - Uncompressed size
		 *  2 bytes - Filename length
		 *  2 bytes - Extra field length
		 *  N bytes - Filename
		 *  M bytes - Extra field
		 */

		view.setUint32(0, HEADER_LOCAL, true);
		view.setUint16(4, ZIP_VERSION, true);
		view.setUint16(6, 0, true); // TODO add correct bit flag
		view.setUint16(8, this.compression, true);
		view.setUint16(10, time, true);
		view.setUint16(12, date, true);
		view.setUint32(16, this.crc, true);
		view.setUint32(20, this.compressed_size, true);
		view.setUint32(24, this.uncompressed_size, true);
		view.setUint16(26, encoded_filename.length, true);
		view.setUint16(28, M, true);
		
		uintview.set(encoded_filename, 30);

		if (this.extra) {
			uintview.set(this.extra, 30 + N);
		}

		// might be a 12 - 16 byte footer here, depending on the value of flag

		return buffer;
    }

    generate_cd (filename: string, local_position: number): ArrayBuffer {
		const encoded_filename = encode_utf8_string(filename);
		const N = encoded_filename.length;
		const M = this.extra ? this.extra.length : 0;
		const K = this.comment ? this.comment.length : 0;
        const length = 46 + M + N + K;
		const buffer = new ArrayBuffer(length);
		const view = new DataView(buffer);
		const uintview = new Uint8Array(buffer);
		
		/*
		 *	4 bytes - Central directory header signature
		 *	2 bytes - Version made by
		 *	2 bytes - Minimum require version
		 *	2 bytes - Bit flag
		 *	2 bytes - Compression method
		 *  2 bytes - Last modified time
		 *  2 bytes - Last modified date
		 *  4 bytes - CRC
		 *  4 bytes - Compressed size
		 *  4 bytes - Uncompressed size
		 *  2 bytes - Filename length
		 *  2 bytes - Extra field length
		 *  2 bytes - File comment length
		 *  2 bytes - Disk number
		 *  2 bytes - Internal file attribute
		 *  4 bytes - External file attribute
		 *  4 bytes - Local position
		 *  N bytes - Filename
		 *  M bytes - Extra field
		 *  K bytes - File comment
		 */

		const [date, time] = dos_time_from_date(this.modified);
		
		view.setUint32(0, HEADER_CD, true);
		view.setUint16(4, ZIP_VERSION, true);
		view.setUint16(6, ZIP_VERSION, true);
		view.setUint16(8, 0, true); // TODO add correct bit flag
		view.setUint16(10, this.compression, true);
		view.setUint16(12, time, true);
		view.setUint16(14, date, true);
		view.setUint32(16, this.crc, true);
		view.setUint32(20, this.compressed_size, true);
		view.setUint32(24, this.uncompressed_size, true);
		view.setUint16(28, encoded_filename.length, true);
		view.setUint16(30, M, true);
		view.setUint16(32, K, true);
		view.setUint16(34, 0, true);
		view.setUint16(36, this.internal_file_attr & 0xFFFF, true);
		view.setUint32(38, this.external_file_attr & 0xFFFFFFFF, true);
		view.setUint32(42, local_position, true);

        uintview.set(encoded_filename, 46);

		if (this.extra) {
			uintview.set(this.extra, 46 + N);
		}

        if (this.comment) {
			uintview.set(this.comment, 46 + N + M);
        }
        
        return buffer;
    }

    get_backing_object (): Blob {
        return this.blob;
    }
	
	async get_blob (): Promise<Blob> {
		if (this.compression === 8)
			return this.decompress();

		assert(this.compression !== 0, "Incompatible compression type");
		return this.blob;
	}

	async get_array_buffer (): Promise<ArrayBuffer> {
		const blob = await this.get_blob();
		return await new Response(blob).arrayBuffer();
	}

	async get_string (): Promise<string> {
		const blob = await this.get_blob();
		return await new Response(blob).text();
	}
}