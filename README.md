# Nexus P2P: Decentralized Encrypted Communication Framework

Nexus P2P is a serverless, single-file communication application designed for secure, peer-to-peer (P2P) data and media exchange. By utilizing WebRTC technology, the platform facilitates direct browser-to-browser connectivity, eliminating the need for centralized databases or intermediate message storage.

## 1. Technical Architecture

The application is architected as a standalone HTML5 entity, integrating logic, styling, and communication protocols into a single portable file.

*   **P2P Protocol:** Implementation of WebRTC via the PeerJS library for signaling and data channel management.
*   **Cryptography:** End-to-End Encryption (E2EE) powered by the Web Crypto API using AES-GCM 256-bit algorithms.
*   **Data Persistence:** Local storage of chat history and user configurations within the browser's IndexedDB and LocalStorage.
*   **Network Requirements:** Static hosting compatibility (e.g., GitHub Pages) with no backend requirements.

## 2. Security and Privacy Protocols

### 2.1 Metadata Sanitization
To ensure high levels of privacy, the system includes a dedicated sanitization layer:
*   **Visual Media:** All transmitted images are processed through an off-screen HTML5 Canvas. This procedure programmatically strips EXIF data, GPS coordinates, and device-specific technical signatures.
*   **Binary Data:** Files are handled as raw Blobs to prevent unintended metadata leakage.

### 2.2 Identity Management
The system operates on a zero-registration principle.
*   **Cryptographic ID:** Upon initial execution, a unique 24-character ID is generated locally.
*   **Authentication:** Connection established via direct ID/Key exchange. No personal data (Email, Phone) is required or collected.

## 3. Functional Specifications

### 3.1 Communication Suite
*   **Real-time Messaging:** Encrypted text exchange with delivery status.
*   **Voice Messaging:** Integrated recording and transmission of asynchronous audio notes.
*   **Media Calls:** High-definition, encrypted audio and video conferencing via direct P2P streams.
*   **Remote Deletion:** Support for "Delete for Everyone" functionality by sending a synchronized wipe command to the peer's local database.

### 3.2 User Interface Structure
The interface follows a high-efficiency triple-pane layout:
1.  **Primary Navigation (Left):** Contact discovery (Add by ID), active chat list management, and profile configuration.
2.  **Communication Hub (Center):** Active session header (Nickname/Avatar), message stream, and integrated input controls for media attachments and voice notes.
3.  **Information Panel (Right):** Extended peer profile and categorized archives for Media, Documents, and Hyperlinks.

## 4. Data Portability and Recovery

Given the absence of a central server, users are responsible for their local data state:
*   **Export:** Generates a secure, encrypted JSON backup containing all chat logs, contact lists, and cryptographic keys.
*   **Import:** Restores the full application state from a backup file, enabling continuity after browser cache clearance or device migration.

## 5. Deployment Instructions

1.  Download the `index.html` source file.
2.  Deploy to a static web server or host via GitHub Pages.
3.  Upon first launch, configure a local nickname and avatar.
4.  Distribute the 24-character ID to authorized peers to initiate communication.

## 6. Technical Stack
*   **Frontend:** HTML5, CSS3 (Tailwind CSS via CDN), JavaScript (ES6+).
*   **Connectivity:** PeerJS.
*   **Security:** Web Crypto API.
*   **Storage:** IndexedDB API.

---

### Disclaimer
This software is provided for privacy-focused communication. Users are responsible for managing their backup files, as lost keys or IDs cannot be recovered by any third party due to the decentralized nature of the platform.
