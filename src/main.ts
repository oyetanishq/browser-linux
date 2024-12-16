import "./style.css";
import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { molokaiTheme, vmOptions } from "./lib/constants";

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

const cacheUrl = new URL("bin/vm-state.bin", window.location as any as URL);
const saveState = async (state: number) => {
	const blob = new Blob([new Uint8Array(state)], { type: "application/octet-stream" });

	const headers = new Headers();
	headers.append("Content-Type", "application/octet-stream");
	headers.append("Content-Length", blob.size.toString());

	const request = new Request(cacheUrl, { method: "GET", headers });
	const response = new Response(blob, { status: 200, statusText: "Linux VM machine state cached" });

	await caches
		.open("vm-state")
		.then(async (cache) => await cache.put(request, response))
		.catch((err) => console.error(err));
};

const getState = async () => await caches.open("vm-state").then((cache) => cache.match(cacheUrl));
const hasState = async () => await getState().then((response) => !!response);

(async () => {
	const terminal = new Terminal({ theme: molokaiTheme });
	const fitAddon = new FitAddon();

	terminal.open(document.getElementById("terminal")!);
	terminal.loadAddon(fitAddon);
	terminal.reset();
	fitAddon.fit();
	window.onresize = () => fitAddon.fit();

	let emulator: any = null;

	try {
		if (await hasState())
			await getState()
				.then((response) => response!.arrayBuffer())
				.then((arrayBuffer) => URL.createObjectURL(new Blob([arrayBuffer], { type: "application/octet-stream" })))
				.then((url) => (emulator = new (window as any).V86({ ...vmOptions, initial_state: { url } })));
		else throw new Error("No old state found");
	} catch (error) {
		// something went wrong, making new state
		emulator = new (window as any).V86(vmOptions);
		emulator.add_listener("download-progress", ({ loaded, total }: { loaded: number; total: number }) => {
			document.getElementById("progress-bar-parent")!.hidden = false;
			document.getElementsByTagName("progress")[0]!.value = (loaded / total) * 100;

			if (loaded / total >= 0.99) document.getElementById("progress-bar-parent")!.hidden = true;
		});

		await waitForSetpUpPrompt(emulator, terminal);
		await saveState(await emulator.save_state());
	}

	(window as any).emulator = emulator;
	(window as any).terminal = terminal;

	terminal.reset();
	terminal.writeln("Linux 4.15.7.");
	terminal.write("/ # ");

	terminal.onKey(({ key }) => emulator.serial0_send(key));
	emulator.add_listener("serial0-output-byte", (byte: number) => terminal.write(String.fromCharCode(byte)));

	setInterval(async () => await saveState(await emulator.save_state()), 10 * 1000); // save state every 10 seconds.

	console.log({ terminal, emulator });
})();
