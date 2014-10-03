
# Backbone IndexedDB DualStorage adapter (don't use in production!)

Inspired by [Backbone.dualStorage](https://github.com/nilbus/Backbone.dualStorage) but with bigger database capabilities thanks to IndexedDB.

# Dependencies

```json
	{
		"backbone": "~1.1.2",
		"underscore": "~1.7.0",
		"indexeddb-backbonejs-adapter": "git://github.com/SonoIo/indexeddb-backbonejs-adapter.git#master",
		"jquery": "~2.1.1",
		"idb": "~1.0.0"
	}
```

# To do

- Documentation
- Add more tests
- Refactoring
  - Beautify the code
  - Remove the indexeddb-backbonejs-adapter dependency
  - Use only one database, not two
- Implementations
  - persistent connection to IndexedDB

# License

MIT

