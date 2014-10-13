;(function (root, factory) {

	if (typeof define === 'function' && define.amd) {
		define(['backbone', 'underscore', 'backbone-indexeddb', 'idb'], function (Backbone, _, indexedDbSync, IDB) {
			var obj = factory(root, Backbone, _, indexedDbSync, IDB);
			root.Backbone.sync = obj.dualSync;
			return obj;
		});
	}
	else if (typeof exports !== 'undefined') {
		var Backbone = require('backbone');
		var _ = require('underscore');
		var indexedDbSync = require('backbone-indexeddb').sync;
		var IDB = require('idb');
		module.exports = factory(root, Backbone, _, indexedDbSync, IDB);
	}
	else {
		var obj = factory(root, root.Backbone, root._, root.Backbone.sync, root.IDB);
		root.Backbone.sync = obj.dualSync;
		root.DirtyStore = obj.DirtyStore;
	}

}(this, function (root, Backbone, _, indexedDbSync, IDB) {


	// Generate four random hex digits.
	function S4() {
		return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
	}
	// Generate a pseudo-GUID by concatenating random hexadecimal.
	function guid() {
		return (S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4());
	}


	var instance;

	var DirtyStore = function DirtyStore() {};

	DirtyStore.getInstance = function getInstance(done) {
		/* // Singleton
		if (!instance) {
			var instance = new DirtyStore();
			instance.init(function (err) {
				if (err) return done(err);
				return done(null, instance);
			});
		}
		else {
			done(null, instance);
		}
		*/

		var newInstance = new DirtyStore();
		newInstance.init(function (err) {
			if (err) return done(err);
			return done(null, newInstance);
		});
	};

	DirtyStore.prototype.init = function init(done) {
		var self = this;

		var options = {
			name: 'dirtystore',
			version: 1
		};

		var db = self.db = new IDB(options);
		db.onConnect = function() {
			done();
		};
		db.onError = function (err) {
			done(err);
		};
		db.onUpgrade = function(db, oldVersion, newVersion) {
			// Version 1
			if (oldVersion < 1 && 1 <= newVersion) {
				var dirtyStore = db.createObjectStore('dirty', { keyPath: 'id', autoIncrement: false });
				dirtyStore.createIndex('modelIdAndStoreNameIndex', ['modelId', 'storeName'], { unique: true });
				dirtyStore.createIndex('storeNameIndex', 'storeName', { unique: false });

				var destroyedStore = db.createObjectStore('destroyed', { keyPath: 'id', autoIncrement: false });
				destroyedStore.createIndex('modelIdAndStoreNameIndex', ['modelId', 'storeName'], { unique: true });
				destroyedStore.createIndex('storeNameIndex', 'storeName', { unique: false });
			}
		};
	};

	DirtyStore.prototype.addDirty = function addDirty(model, done) {
		var self = this;

		self.findDirty(model, function (err, result) {
			if (err) return done(err);
			if (result) return done(null, result.id);
			var data = {
				id: self.getNewId(),
				modelId: model.id,
				storeName: _.result(model, 'storeName')
			};
			self.db.add('dirty', data, done);
		});

		return self;
	};

	DirtyStore.prototype.addDestroyed = function addDestroyed(model, done) {
		var self = this;

		self.findDestroyed(model, function (err, result) {
			if (err) return done(err);
			if (result) return done(null, result.id);
			var data = {
				id: self.getNewId(),
				modelId: model.id,
				storeName: _.result(model, 'storeName')
			};
			self.db.add('destroyed', data, done);
		});

		return self;
	};

	DirtyStore.prototype.clear = function clear(done) {
		var self = this;
		self.db.clear('dirty', function (err) {
			if (err) return done(err);
			self.db.clear('destroyed', function (err) {
				if (err) return done(err);
				done();
			});
		});
	};

	DirtyStore.prototype.hasDirtyOrDestroyed = function hasDirtyOrDestroyed(done) {
		var self = this;

		self.db.count('dirty', function (err, count) {
			if (err) return done(err);
			if (count > 0) return done(null, true);

			self.db.count('destroyed', function (err, count) {
				if (err) return done(err);
				if (count > 0) return done(null, true);
				return done(null, false);
			});
		});
	};

	DirtyStore.prototype.findDirty = function findDirty(model, done) {
		var self = this;
		var store = _.result(model, 'storeName');

		if (!model.id)
			return done();

		var conditions = {
			index: 'modelIdAndStoreNameIndex',
			keyRange: self.db.makeKeyRange({
				only: [model.id, store]
			})
		};

		self.db.find('dirty', conditions, function (err, result) {
			if (err) return done(err);
			if (result.length > 0)
				done(null, result[0]);
			else
				done();
		});
	};

	DirtyStore.prototype.findAllDirty = function findAllDirty(store, done) {
		var self = this;

		var conditions = {
			index: 'storeNameIndex',
			keyRange: self.db.makeKeyRange({
				only: store
			}),
		};

		self.db.find('dirty', conditions, function (err, results) {
			if (err) return done(err);
			done(null, results);
		});
	};

	DirtyStore.prototype.findDestroyed = function findDestroyed(model, done) {
		var self = this;
		var store = _.result(model, 'storeName');

		if (!model.id)
			return done();

		var conditions = {
			index: 'modelIdAndStoreNameIndex',
			keyRange: self.db.makeKeyRange({
				only: [model.id, store]
			})
		};

		self.db.find('destroyed', conditions, function (err, result) {
			if (err) return done(err);
			if (result.length > 0)
				done(null, result[0]);
			else
				done();
		});
	};

	DirtyStore.prototype.findAllDestroyed = function findAllDestroyed(store, done) {
		var self = this;

		var conditions = {
			index: 'storeNameIndex',
			keyRange: self.db.makeKeyRange({
				only: store
			}),
		};

		self.db.find('destroyed', conditions, function (err, results) {
			if (err) return done(err);
			done(null, results);
		});
	};

	DirtyStore.prototype.removeDirty = function removeDirty(model, done) {
		var self = this;

		var removed = function removed(err) {
			if (err) return done(err);
			done();
		};

		self.findDirty(model, function (err, result) {
			if (err) return done(err);
			if (!result) return done(null, result);
			self.db.delete('dirty', result.id, removed);
		});
	};

	DirtyStore.prototype.removeDestroyed = function removeDestroyed(model, done) {
		var self = this;

		var removed = function removed(err) {
			if (err) return done(err);
			done();
		};

		self.findDestroyed(model, function (err, result) {
			if (err) return done(err);
			if (!result) return done(null, result);
			self.db.delete('destroyed', result.id, removed);
		});
	};

	DirtyStore.prototype.reset = function reset(store, done) {
		var self = this;
		self.resetDirty(store, function (err) {
			if (err) return done(err);
			self.resetDestroyed(store, function (err) {
				if (err) return done(err);
				done();
			});
		});
	};

	DirtyStore.prototype.resetDirty = function resetDirty(store, done) {
		var self = this;
		var conditions = {
			index: 'storeNameIndex',
			keyRange: self.db.makeKeyRange({
				only: store
			}),
		};
		self.db.deleteAll('dirty', conditions, function (err) {
			if (err) return done(err);
			done();
		});
	};

	DirtyStore.prototype.resetDestroyed = function resetDestroyed(store, done) {
		var self = this;
		var conditions = {
			index: 'storeNameIndex',
			keyRange: self.db.makeKeyRange({
				only: store
			}),
		};
		self.db.deleteAll('destroyed', conditions, function (err) {
			if (err) return done(err);
			done();
		});
	};

	DirtyStore.prototype.close = function close() {
		this.db.close();
	};

	DirtyStore.prototype.getNewId = function getNewId() {
		return guid();
	};






	Backbone.DualStorage = {
		persistent: false, // Use it if you need a persistent connection (not implemented yet)
		forceOffline: false, // change to true to emulate the offline mode
		offlineStatusCodes: [408, 502]
	};

	// Utility function
	var modelUpdatedWithResponse = function modelUpdatedWithResponse(model, response) {
		var modelClone;
		modelClone = new Backbone.Model;
		modelClone.idAttribute = model.idAttribute;
		modelClone.database = model.database;
		modelClone.storeName = model.storeName;
		modelClone.set(model.attributes);
		modelClone.set(model.parse(response));
		return modelClone;
	};

	var parseRemoteResponse = function parseRemoteResponse(object, response) {
		if (!(object && object.parseBeforeLocalSave)) {
			return response;
		}
		if (_.isFunction(object.parseBeforeLocalSave)) {
			return object.parseBeforeLocalSave(response);
		}
	};

	// async.js#eachSeries
	var eachSeries = function eachSeries(arr, iterator, callback) {
		callback = callback || function () {};
		if (!arr.length) {
			return callback();
		}
		var completed = 0;
		var iterate = function () {
			iterator(arr[completed], function (err) {
				if (err) {
					callback(err);
					callback = function () {};
				}
				else {
					completed += 1;
					if (completed >= arr.length) {
						callback();
					}
					else {
						iterate();
					}
				}
			});
		};
		iterate();
	};



	Backbone.Model.prototype.hasTempId = function() {
		return _.isString(this.id) && this.id.length === 36;
	};

	Backbone.Collection.prototype.syncDirty = function syncDirty(done) {
		var self = this;

		var response = {};
		var save = function save(aModel, next) {
			aModel.save(null, {
				success: function (resp) {
					response[aModel.id] = resp;
					return next(); 
				},
				error: function (err) {
					return next(err); 
				}
			});
		};

		var getDirtyModelIds = function (store, callback) {
			DirtyStore.getInstance(function (err, store) {
				if (err) return callback(err);
				store.findAllDirty(storeName, function (err, dirtyModels) {
					if (err) return callback(err);
					var dirtyModelIds = [];
					_.forEach(dirtyModels, function (aDirtyModel) {
						dirtyModelIds.push(aDirtyModel.modelId);
					});
					callback(null, dirtyModelIds);
				});
			});
		};

		var storeName = _.result(self, 'storeName');
		getDirtyModelIds(storeName, function (err, dirtyModelIds) {
			if (err) return done(err);
			var arrayOfDirtyModels = self.filter(function (aModel) {
				return dirtyModelIds.indexOf(aModel.id) >= 0;
			});
			eachSeries(arrayOfDirtyModels, save, function (err) {
				if (err) return done(err);
				done(null, response);
			});
		});
	};

	Backbone.Collection.prototype.syncDestroyed = function syncDestroyed(done) {
		var self = this;

		var response = {};
		var destroy = function destroy(anId, next) {
			var aModel = new self.model();
			aModel.set(_.result(aModel, 'idAttribute'), anId);
			aModel.collection = self;
			aModel.destroy({
				success: function (resp) {
					response[aModel.id] = resp;
					return next(); 
				},
				error: function (err) {
					return next(err); 
				}
			});
		};

		var getDestroyedModelIds = function (store, callback) {
			DirtyStore.getInstance(function (err, store) {
				if (err) return callback(err);
				store.findAllDestroyed(storeName, function (err, destroyedModels) {
					if (err) return callback(err);
					var destroyedModelIds = [];
					_.forEach(destroyedModels, function (aDestroyedModel) {
						destroyedModelIds.push(aDestroyedModel.modelId);
					});
					callback(null, destroyedModelIds);
				});
			});
		};

		var storeName = _.result(self, 'storeName');
		getDestroyedModelIds(storeName, function (err, destroyedModelIds) {
			if (err) return done(err);
			eachSeries(destroyedModelIds, destroy, function (err) {
				if (err) return done(err);
				done(null, response);
			});
		});
	};

	Backbone.Collection.prototype.syncDirtyAndDestroyed = function syncDirtyAndDestroyed(done) {
		var self = this;
		self.syncDirty(function (err, dirtyResponse) {
			if (err) return done(err);
			self.syncDestroyed(function (err, destroyedResponse) {
				if (err) return done(err);
				var response = {
					dirty: dirtyResponse,
					destroyed: destroyedResponse
				};
				done(null, response);
			});
		});
	};



	var onlineSync = function onlineSync(method, model, options) {
		if (Backbone.DualStorage.forceOffline) {
			var fakeResponse = {
				status: 502,
				response: 'Fake bad gateway'
			};
			return options.error(fakeResponse);
		}

		var _ajaxSync = Backbone.ajaxSync;
		return _ajaxSync(method, model, options);
	};

	var localSync = function localSync(method, model, options) {
		var _indexedDbSync = Backbone.indexedDbSync;
		var success = options.success;
		var error   = options.error;

		var onReady = function onReady(err, store) {
			if (err) return error(err);

			var responseHandler = function responseHandler(err, result) {
				// Chiudo la connessione al DB
				store.close();
				if (err) return error(err);
				success(result);
			};

			switch (method) {
				case 'read':
					options.success = function(resp) {
						return responseHandler(null, resp);
					};
					options.error = function(err) {
						return responseHandler(err);
					};
					_indexedDbSync(method, model, options);
					break;
				case 'create':
					if (options.add && !options.merge) {
						store.findDirty(model, responseHandler);
					}
					else {
						options.success = function (resp) {
							if (options.dirty) {
								var updatedModel = modelUpdatedWithResponse(model, resp);
								store.addDirty(updatedModel, function (err) {
									return responseHandler(err, updatedModel);
								});
							}
							else {
								return responseHandler(null, model);
							}
						};
						options.error = function (err) {
							responseHandler(err);
						};
						_indexedDbSync(method, model, options);
					}
					break;
				case 'update':
					options.success = function (resp) {
						if (options.dirty) {
							store.addDirty(model, function (err) {
								responseHandler(err, resp);
							});
						}
						else {
							store.removeDirty(model, function (err) {
								responseHandler(err, resp);
							});
						}
					};
					_indexedDbSync(method, model, options);
					break;
				case 'delete':
					options.success = function (resp) {
						if (options.dirty) {
							if (model.hasTempId()) {
								return store.removeDirty(model, responseHandler);
							}
							else {
								return store.addDestroyed(model, responseHandler);
							}
						}
						else {
							if (model.hasTempId()) {
								return store.removeDirty(model, responseHandler);
							}
							else {
								return store.removeDestroyed(model, responseHandler);
							}
						}
					};
					_indexedDbSync(method, model, options);
					break;
				case 'closeall':
					_indexedDbSync(method, model, options);
					responseHandler();
					break;
				case 'hasDirtyOrDestroyed':
					store.hasDirtyOrDestroyed(responseHandler);
					break;
				case 'reset':
					if (model instanceof Backbone.Collection) {
						var collection = model;
						var storeName = _.result(collection.model.prototype, 'idAttribute');
						store.reset(storeName, responseHandler);
					}
					else {
						var storeName = _.result(model.prototype, 'idAttribute');
						store.reset(storeName, responseHandler);
					}
					break;
			}
		};

		DirtyStore.getInstance(onReady);
	};

	var dualSync = function dualSync(method, model, options) {
		var _localSync  = Backbone.localSync;
		var _onlineSync = Backbone.onlineSync;
		var success    = options.success;
		var error      = options.error;

		if (_.result(model, 'local')) {
			return _localSync(method, model, options);
		}

		if (_.result(model, 'remote')) {
			return _onlineSync(method, model, options);
		}

		var relayErrorCallback = function relayErrorCallback(response) {
			var _ref;
			var offline;
			var offlineStatusCodes = Backbone.DualStorage.offlineStatusCodes;
			offline = response.status === 0 || (_ref = response.status, [].indexOf.call(offlineStatusCodes, _ref) >= 0);
			if (offline) {
				options.dirty = true;
				options.success = function(model) {
					return success(model.attributes);
				};
				options.error = function(err) {
					return error(err);
				};
				_localSync(method, model, options);
			}
			else {
				return error(response);
			}
		};

		switch (method) {
			case 'read':
				options.success = function(hasDirty) {
					if (hasDirty) {
						options.dirty = true;
						options.success = function(resp) {
							return success(resp);
						};
						options.error = function(err) {
							return error(err);
						};
						_localSync(method, model, options)
					}
					else {
						options.success = function(resp, status, xhr) {
							var responseModel;
							resp = parseRemoteResponse(model, resp);
							if (model instanceof Backbone.Collection) {
								var collection = model;
								var idAttribute = collection.model.prototype.idAttribute;

								var updateLocalDB = function updateLocalDB() {
									var update = function update(modelAttributes, next) {
										var aModel = collection.get(modelAttributes[idAttribute]);
										if (aModel) {
											responseModel = modelUpdatedWithResponse(aModel, modelAttributes);
										}
										else {
											responseModel = new collection.model(modelAttributes);
										}
										options.success = function() {
											next();
										};
										options.error = function(err) {
											next(err)
										};
										_localSync('update', responseModel, options);
									};
									eachSeries(resp, update, function (err) {
										if (err) return error(err);
										return success(resp, status, xhr);
									});
								};

								if (!options.add) {
									options.success = function() {
										updateLocalDB();
									};
									options.error = function(err) {
										return error(err);
									};
									_localSync('reset', collection, options);
								}
								else {
									updateLocalDB();
								}
							}
							else {
								responseModel = modelUpdatedWithResponse(model, resp);
								options.success = function(updatedResp) {
									return success(updatedResp);
								};
								options.error = function(err) {
									return error(err);
								};
								_localSync('update', responseModel, options);
							}
						};
						options.error = function(resp) {
							return relayErrorCallback(resp);
						};
						return _onlineSync(method, model, options);
					}
				};
				options.error = function(err) {
					return error(err);
				};
				_localSync('hasDirtyOrDestroyed', model, options);
				break;

			case 'create':
				options.success = function(resp, status, xhr) {
					var updatedModel;
					updatedModel = modelUpdatedWithResponse(model, resp);
					options.success = function(model) {
						return success(model.attributes);
					};
					options.error = function(err) {
						return error(err);
					};
					_localSync(method, updatedModel, options);
				};
				options.error = function(resp) {
					return relayErrorCallback(resp);
				};
				return _onlineSync(method, model, options);
				break;

			case 'clear':
				_localSync(method, model, options);
				break;

			case 'closeall':
				_localSync(method, model, options);
				break;

			case 'update':
				if (model.hasTempId()) {
					var temporaryId = model.id;
					options.success = function(resp, status, xhr) {
						var updatedModel;
						updatedModel = modelUpdatedWithResponse(model, resp);
						model.set(model.idAttribute, temporaryId, {
							silent: true
						});
						options.success = function() {
							options.success = function() {
								return success(resp, status, xhr);
							};
							options.error = function(err) {
								return error(err);
							};
							_localSync('create', updatedModel, options);
						};
						options.error = function(resp, status, xhr) {
							return error(err);
						};
						_localSync('delete', model, options);
					};
					options.error = function(resp) {
						model.set(model.idAttribute, temporaryId, {
							silent: true
						});
						return relayErrorCallback(resp);
					};
					model.set(model.idAttribute, null, {
						silent: true
					});
					return _onlineSync('create', model, options);
				}
				else {
					options.success = function(resp, status, xhr) {
						var updatedModel;
						updatedModel = modelUpdatedWithResponse(model, resp);
						options.success = function(model) {
							return success(resp);
						};
						options.error = function(err) {
							return error(err);
						};
						_localSync(method, updatedModel, options);
					};
					options.error = function(resp) {
						return relayErrorCallback(resp);
					};
					return _onlineSync(method, model, options);
				}
				break;

			case 'delete':
				if (model.hasTempId()) {
					return _localSync(method, model, options);
				}
				else {
					options.success = function(resp, status, xhr) {
						options.success = function() {
							return success(resp);
						};
						options.error = function(err) {
							return error(err);
						};
						return _localSync(method, model, options);
					};
					options.error = function(resp) {
						return relayErrorCallback(resp);
					};
					return _onlineSync(method, model, options);
				}
				break;
		}
	};

	// backbone-indexeddb puts the original Backbone.sync into Backbone.ajaxSync,
	// this behaviour, could change in the near future, and I hope it does, 
	// so I applied this workaround to be sure that all will works fine
	if (typeof Backbone.ajaxSync === 'undefined')
		Backbone.ajaxSync = Backbone.sync;

	Backbone.indexedDbSync = indexedDbSync;
	Backbone.onlineSync = onlineSync;
	Backbone.localSync = localSync;
	Backbone.dualSync = dualSync;

	return {
		dualSync: Backbone.dualSync,
		DirtyStore: DirtyStore
	};
}));

