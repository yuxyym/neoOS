# Third party software

The Documents, Spreadsheets, and Presentations apps embed the complete [Online Document Editor](https://github.com/ranuts/document) hosted at [edit.chaxus.com](https://edit.chaxus.com/). The project is derived from ONLYOFFICE and is licensed under AGPL-3.0 with additional Section 7 terms. Its editor UI retains the required ONLYOFFICE branding. neoOS sends it file bytes only when a user opens a file and writes the returned edited bytes into neoOS storage when the user saves.

The editor must be downloaded from its host, so internet access is required. Its upstream project describes editing and conversion as client-side and says document contents are not uploaded. The remote editor code still receives and processes open document bytes in the browser.
