import "./style.css";
import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { molokaiTheme } from "./lib/constants";

const waitForSetpUpPrompt = async (emulator: any, terminal: Terminal): Promise<void> =>
	new Promise((resolve) => {
		let serialBuffer: string = "";
		let screenBuffer: Uint8Array[] | string[] = [];
		let currentRow: any = null;

		const handleScreenCharData = (data: number[]) => {
			const row = data[0];
			const col = data[1];
			const char = data[2];

			// Flush the buffer and advance to next line
			if (row !== currentRow) {
				currentRow = row;
				terminal.writeln(screenBuffer.join(""));
				screenBuffer = [];
			}

			screenBuffer[col] = String.fromCharCode(char);
		};

		const handleSerialCharData = (byte: number) => {
			serialBuffer += String.fromCharCode(byte);

			// Wait for initial root shell prompt, which indicates a completed boot
			if (serialBuffer.endsWith("/ # ")) {
				// Remove boot time screen and serial data handlers and clear the terminal
				emulator.remove_listener("screen-put-char", handleScreenCharData);
				emulator.remove_listener("serial0-output-byte", handleSerialCharData);
				terminal.clear();

				// We're done, we have a prompt, system is ready.
				resolve();
			}
		};

		// Start listening for data over the serial and screen buses.
		emulator.add_listener("screen-put-char", handleScreenCharData);
		emulator.add_listener("serial0-output-byte", handleSerialCharData);
	});

(async () => {
	const terminal = new Terminal({ theme: molokaiTheme });
	const fitAddon = new FitAddon();

	terminal.open(document.getElementById("terminal")!);
	terminal.loadAddon(fitAddon);
	fitAddon.fit();

	window.onresize = () => {
		fitAddon.fit();
	};

	const emulator = new (window as any).V86({
		wasm_path: "v86/v86.wasm",
		memory_size: 512 * 1024 * 1024,
		vga_memory_size: 64 * 1024 * 1024,
		bios: { url: "v86/bios/seabios.bin" },
		vga_bios: { url: "v86/bios/vgabios.bin" },
		cdrom: { url: "v86/images/linux.iso" },
		autostart: true,
		disable_mouse: true,
		disable_keyboard: true,
		disable_speaker: true,
	});

	(window as any).emulator = emulator;
	(window as any).terminal = terminal;

	terminal.reset();

	await waitForSetpUpPrompt(emulator, terminal);

	terminal.reset();
	terminal.writeln("Linux 4.15.7. Shared browser filesystem mounted in /mnt.");
	terminal.write("/ # ");

	terminal.onKey(({ key }) => emulator.serial0_send(key));
	emulator.add_listener("serial0-output-byte", (byte: number) => terminal.write(String.fromCharCode(byte)));

	console.log({ terminal, emulator });
})();
