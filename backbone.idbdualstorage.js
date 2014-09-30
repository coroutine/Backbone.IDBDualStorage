;(function (root, factory) {

	if (typeof define === 'function' && define.amd) {
		define(['backbone', 'underscore'], function(Backbone, _) {
			return (root.Marionette = factory(root, Backbone, _));
		});
	}
	else if (typeof exports !== 'undefined') {
		var Backbone = require('backbone');
		var _ = require('underscore');
		var indexedDbSync = require('backbone-indexeddb').sync;
		module.exports = factory(root, Backbone, _, indexedDbSync);
	}
	else {
		root.Marionette = factory(root, root.Backbone, root._);
	}

}(this, function (root, Backbone, _, indexedDbSync) {

	Backbone.DualStorage = {
		isOnline: false, // change to true to emulate the offline mode
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
			DirtyStore.create(function (err, store) {
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
			async.eachSeries(arrayOfDirtyModels, save, function (err) {
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
			DirtyStore.create(function (err, store) {
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
			async.eachSeries(destroyedModelIds, destroy, function (err) {
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
		var ajaxSync = Backbone.ajaxSync;

		if (Backbone.DualStorage.isOnline)
			return ajaxSync(method, model, options);

		var fakeResponse = {
			status: 502,
			response: 'Fake bad gateway'
		};

		return options.error(fakeResponse);
	};

	var localSync = function localSync(method, model, options) {
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
					indexedDbSync(method, model, options);
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
				case 'create':
					if (options.add && !options.merge) {
						store.findDirty(model, responseHandler);
					}
					else {
						options.success = function (resp) {
							if (options.dirty) {
								var updatedModel = modelUpdatedWithResponse(model, resp);
								store.addDirty(updatedModel, function (err) {
									return responseHandler(null, updatedModel);
								});
							}
							else {
								return responseHandler(null, model);
							}
						};
						options.error = function (err) {
							responseHandler(err);
						};
						indexedDbSync(method, model, options);
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
					indexedDbSync(method, model, options);
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
					indexedDbSync(method, model, options);
					break;
				case 'closeall':
					indexedDbSync(method, model, options);
					responseHandler();
					break;
			}
		};

		DirtyStore.create(onReady);
	};

	var dualSync = function dualSync(method, model, options) {
		var localSync  = Backbone.localSync; // readed again to prevent
		var onlineSync = Backbone.onlineSync;
		var success    = options.success;
		var error      = options.error;

		if (_.result(model, 'local')) {
			return localSync(method, model, options);
		}

		if (_.result(model, 'remote')) {
			return onlineSync(method, model, options);
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
				localSync(method, model, options);
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
						localSync(method, model, options)
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
										localSync('update', responseModel, options);
									};
									async.eachSeries(resp, update, function (err) {
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
									localSync('reset', collection, options);
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
								localSync('update', responseModel, options);
							}
						};
						options.error = function(resp) {
							return relayErrorCallback(resp);
						};
						return onlineSync(method, model, options);
					}
				};
				options.error = function(err) {
					return error(err);
				};
				localSync('hasDirtyOrDestroyed', model, options);
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
					localSync(method, updatedModel, options);
				};
				options.error = function(resp) {
					return relayErrorCallback(resp);
				};
				return onlineSync(method, model, options);
				break;

			case 'clear':
				localSync(method, model, options);
				break;

			case 'closeall':
				localSync(method, model, options);
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
							localSync('create', updatedModel, options);
						};
						options.error = function(resp, status, xhr) {
							return error(err);
						};
						localSync('delete', model, options);
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
					return onlineSync('create', model, options);
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
						localSync(method, updatedModel, options);
					};
					options.error = function(resp) {
						return relayErrorCallback(resp);
					};
					return onlineSync(method, model, options);
				}
				break;

			case 'delete':
				if (model.hasTempId()) {
					return localSync(method, model, options);
				}
				else {
					options.success = function(resp, status, xhr) {
						options.success = function() {
							return success(resp);
						};
						options.error = function(err) {
							return error(err);
						};
						return localSync(method, model, options);
					};
					options.error = function(resp) {
						return relayErrorCallback(resp);
					};
					return onlineSync(method, model, options);
				}
				break;
		}
	};

	Backbone.indexedDbSync = indexedDbSync;
	Backbone.onlineSync = onlineSync;
	Backbone.localSync = localSync;
	Backbone.dualSync = dualSync;

	return Backbone.dualSync;
}));

