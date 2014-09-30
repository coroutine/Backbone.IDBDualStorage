
var assert = chai.assert;


window.indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
window.IDBTransaction = window.IDBTransaction || window.webkitIDBTransaction || window.msIDBTransaction;
window.IDBKeyRange = window.IDBKeyRange || window.webkitIDBKeyRange || window.msIDBKeyRange;


var deleteDatabase = function deleteDatabase(dbName, done) {
	setTimeout(function(){
		var DBDeleteRequest = window.indexedDB.deleteDatabase(dbName);
		DBDeleteRequest.onerror = function(e) {
			done(e);
		};
		DBDeleteRequest.onsuccess = function(e) {
			done();
		};
		DBDeleteRequest.onblocked = function(e) {
			done(new Error('Database ' + dbName + ' is blocked'));
		};
	}, 200);
};

var deleteAllDatabase = function deleteAllDatabase(done) {
	deleteDatabase('testdb', function (err) {
		if (err) return done(err);
		deleteDatabase('dirty', function (err) {
			if (err) return done(err);
			deleteDatabase('destroyed', function (err) {
				if (err) return done(err);
				done();
			});
		});
	});
};

var closeAllDatabaseConnections = function closeAllDatabaseConnections(done) {
	Backbone.sync('closeall', null, {
		success: function() {
			done();
		},
		error: function(err) {
			done(err);
		}
	});
};

var databaseId = 'testdb';
var database = window.database = {
	id: databaseId,
	description: "The database for test",
	migrations: [{
		version: 1,
		migrate: function (transaction, next) {
			var customers = transaction.db.createObjectStore("customers");
			next();
		}
	}]
};

var openDB = function openDB(db, done) {
	var request = indexedDB.open(db, 1);

	request.onsuccess = function(e) {
		var db = e.target.result;
		done(null, db);
	};
	request.onerror = done;
};

var getItem = function getItem(options, done) {
	if (!options.storeName) return done(new Error('Missing storeName'));
	if (!options.db)        return done(new Error('Missing DB'));

	var db;
	var result;

	var handleResponse = function handleResponse(err, result) {
		db.close();
		done(err, result);
	};

	var onReady = function onReady(err, instance) {
		if (err) return done(err);

		db = instance;

		var trans = db.transaction([options.storeName], 'readwrite');
		var store = trans.objectStore(options.storeName);

		var keyRange;
		if (typeof options.key === 'undefined')
			keyRange = IDBKeyRange.lowerBound(0);
		else
			keyRange = IDBKeyRange.only(options.key);

		var cursorRequest = store.openCursor(keyRange);

		cursorRequest.onsuccess = function (e) {
			result = e.target.result;
			// if (result == false)
			//     result.continue();
			return;
		};

		cursorRequest.onerror = handleResponse;

		trans.oncomplete = function() {
			if(!!result == false)
				return handleResponse();
			handleResponse(null, result.value);
		};
	};

	openDB(options.db, onReady);
};


var Customer = Backbone.Model.extend({
	database: database,
	storeName: 'customers',
	idAttribute: '_id'
});

var Customers = Backbone.Collection.extend({
	database: database,
	storeName: 'customers',
	url: '/api/customers',
	model: Customer
});

var Order = Backbone.Model.extend({
	database: database,
	storeName: 'orders',
	idAttribute: '_id'
});

describe('DirtyStore', function() {

	beforeEach(function (done) {
		deleteAllDatabase(done);
	});

	afterEach(function (done) {
		closeAllDatabaseConnections(done);
	});

	it('Reset dirty and destroyed stores', function (done) {

		DirtyStore.create(function (err, store) {
			if (err) return done(err);

			var finalize = function finalize() {
				store.close();
				done();
			};

			var checkDestroyedStore = function checkDestroyedStore() {
				var options = {
					key: 1,
					storeName: 'destroyed',
					db: 'destroyed'
				};
				getItem(options, function (err, result) {
					if (err) return done(err);
					assert.isUndefined(result, 'No customer should be saved');
					var options = {
						key: 3,
						storeName: 'dirty',
						db: 'dirty'
					};
					getItem(options, function (err, result) {
						if (err) return done(err);
						assert.isDefined(result, 'Order should be saved');
						assert.equal(result.modelId, 'fake-order-id-1');
						finalize();
					});
				});
			};

			var checkDirtyStore = function checkDirtyStore() {
				var options = {
					key: 1,
					storeName: 'dirty',
					db: 'dirty'
				};
				getItem(options, function (err, result) {
					if (err) return done(err);
					assert.isUndefined(result, 'No customer should be saved');
					var options = {
						key: 3,
						storeName: 'dirty',
						db: 'dirty'
					};
					getItem(options, function (err, result) {
						if (err) return done(err);
						assert.isDefined(result, 'Order should be saved');
						assert.equal(result.modelId, 'fake-order-id-1');
						checkDestroyedStore();
					});
				});
			};

			var reset = function reset() {
				store.reset(Customer.prototype.storeName, function (err) {
					if (err) return done(err);
					checkDirtyStore();
				});
			};

			var customerA = new Customer({
				_id: 'fake-customer-id-1',
				firstname: 'Matteo',
				lastname: 'Baggio'
			});

			var customerB = new Customer({
				_id: 'fake-customer-id-2',
				firstname: 'Michele',
				lastname: 'Belluco'
			});

			var orderA = new Order({
				_id: 'fake-order-id-1',
				_customerId: 'fake-customer-id-1',
				total: 550
			});

			store.addDirty(customerA, function (err) {
				if (err) return done(err);
				store.addDirty(customerB, function (err) {
					if (err) return done(err);
					store.addDirty(orderA, function (err) {
						if (err) return done(err);
						store.addDestroyed(customerA, function (err) {
							if (err) return done(err);
							store.addDestroyed(customerB, function (err) {
								if (err) return done(err);
								store.addDestroyed(orderA, function (err) {
									if (err) return done(err);
									reset();
								});
							});
						});
					});
				});
			});
		});
	});
});

describe('Offline mode', function() {

	beforeEach(function (done) {
		Backbone.DualStorage.isOnline = false;
		deleteAllDatabase(done);
	});

	afterEach(function (done) {
		closeAllDatabaseConnections(done);
	});

	it('Should create a new customer', function (done) {
		var customers = new Customers();
		var customer = new Customer();

		customers.add(customer);

		customer.save({
			firstname: 'Matteo',
			lastname: 'Baggio',
			company: 'ACME',
			cf: 'XXXX99999XXXX',
			vat: '01234567890',
			iban: 'IT011C010000000000000012234'
		}, {
			success: function() {
				assert.isNotNull(customer.id, 'model.id should be not null');
				done();
			},
			error: done
		});
	});

	it('Should update a customer', function (done) {
		var customers = new Customers();
		var customer = new Customer();

		customers.add(customer);

		var onSuccess = function onSuccess() {
			assert.isNotNull(customer.id, 'model.id should be not null');
			customer.save({
				firstname: 'Michele',
				lastname: 'Belluco'
			}, {
				success: function(model) {
					assert.equal(model.get('firstname'), 'Michele');
					assert.equal(model.get('lastname'), 'Belluco');
					assert.equal(model.get('company'), 'ACME');
					done();
				},
				error: done
			});
		};

		customer.save({
			firstname: 'Matteo',
			lastname: 'Baggio',
			company: 'ACME',
			cf: 'XXXX99999XXXX',
			vat: '01234567890',
			iban: 'IT011C010000000000000012234'
		}, {
			success: onSuccess,
			error: done
		});
	});

	it('Should delete a customer', function (done) {
		var customers = new Customers();
		var customer = new Customer();

		customers.add(customer);

		var deleteCustomer = function deleteCustomer(model) {
			model.destroy({
				success: function() {
					assert.equal(customers.length, 0, 'No items in the customers collection');
					checkDirtyStore(model);
				},
				error: done
			});
		};

		var checkDirtyStore = function checkDirtyStore(model) {
			DirtyStore.create(function (err, store) {
				store.findDirty(model, function (err, result) {
					store.close();
					if (err) return done(err);
					assert.isNull(result, 'Dirty data should be empty');
					done();
				});
			});
		};

		customer.save({
			firstname: 'Matteo',
			lastname: 'Baggio',
			company: 'ACME',
			cf: 'XXXX99999XXXX',
			vat: '01234567890',
			iban: 'IT011C010000000000000012234'
		}, {
			success: deleteCustomer,
			error: done
		});
	});

	it('Should read a collection of customers', function (done) {
		var customers = new Customers();
		var customerA = new Customer();
		var customerB = new Customer();

		customers.add(customerA);
		customers.add(customerB);

		var readCustomers = function readCustomers() {
			var readedCustomers = new Customers();
			readedCustomers.fetch({
				success: function(){
					assert.equal(readedCustomers.length, 2, 'Customers length should be greater than zero');
					assert.equal(readedCustomers.get(customerA.id).get('firstname'), 'Matteo');
					assert.equal(readedCustomers.get(customerB.id).get('firstname'), 'Michele');
					done();
				},
				error: done
			});
		};

		var saveCustomerB = function saveCustomerB() {
			customerB.save({
				firstname: 'Michele',
				lastname: 'Belluco',
				company: 'ACME',
			}, {
				success: readCustomers,
				error: done
			});
		};

		customerA.save({
			firstname: 'Matteo',
			lastname: 'Baggio',
			company: 'ACME',
		}, {
			success: saveCustomerB,
			error: done
		});
	});

	it('Should read a single customer', function (done) {
		var customerA = new Customer();

		var fetchCustomer = function fetchCustomer() {
			var customerB = new Customer();
			customerB.set('_id', 'this-is-a-client-id');
			customerB.fetch({
				success: function() {
					assert.equal(customerB.get('firstname'), 'Matteo');
					assert.equal(customerB.get('lastname'), 'Baggio');
					assert.equal(customerB.get('company'), 'ACME');
					done();
				},
				error: done
			});
		};

		customerA.save({
			_id: 'this-is-a-client-id',
			firstname: 'Matteo',
			lastname: 'Baggio',
			company: 'ACME'
		}, {
			success: function() {
				assert.isNotNull(customerA.id);
				fetchCustomer();
			},
			error: done
		});
	});

});


describe('Online mode', function() {

	before(function (done) {
		Backbone.DualStorage.isOnline = true;
		done();
	});

	beforeEach(function (done) {
		deleteAllDatabase(done)
	});

	afterEach(function (done) {
		closeAllDatabaseConnections(done);
	});

	it('Should create a new customer', function (done) {
		Backbone.ajaxSync = function (method, model, options) {
			options.success({
				_id: 'this-is-the-server-id'
			});
		};

		var checkDirtyStore = function() {
			var options = {
				key: 'this-is-the-server-id',
				storeName: 'customers',
				db: databaseId
			};
			getItem(options, function (err, result) {
				if (err) return done(err);
				assert.isNotNull(result, 'Customer should be saved on DB');
				assert.equal(result._id, 'this-is-the-server-id', 'result._id should filled by the server');
				assert.equal(result.firstname, 'Matteo');

				var options = {
					storeName: 'dirty',
					db: 'dirty'
				};
				getItem(options, function (err, result) {
					if (err) return done(err);
					assert.isUndefined(result, 'Dirty store should be empty');
					done();
				});
			});
		};

		var customers = new Customers();
		var customer = new Customer();

		customers.add(customer);

		customer.save({
			firstname: 'Matteo',
			lastname: 'Baggio',
			company: 'ACME',
			cf: 'XXXX99999XXXX',
			vat: '01234567890',
			iban: 'IT011C010000000000000012234'
		}, {
			success: function() {
				assert.equal(customer.id, 'this-is-the-server-id', 'model.id should be filled by the server');
				checkDirtyStore();
			},
			error: done
		});
	});

	it('Should update a customer', function (done) {
		Backbone.onlineSync = function (method, model, options) {
			options.success({
				_id: 'this-is-the-server-id'
			});
		};

		var customers = new Customers();
		var customer = new Customer();

		customers.add(customer);

		var updateCustomer = function updateCustomer() {
			assert.isNotNull(customer.id, 'model.id should be not null');
			customer.save({
				firstname: 'Michele',
				lastname: 'Belluco'
			}, {
				success: function(model) {
					assert.equal(model.get('firstname'), 'Michele', 'Should update firstname');
					assert.equal(model.get('lastname'), 'Belluco', 'Should update lastname');
					assert.equal(model.get('company'), 'ACME', 'Should update company');
					checkDirtyStore();
				},
				error: done
			});
		};

		var checkDirtyStore = function checkDirtyStore() {
			var options = {
				key: 'this-is-the-server-id',
				storeName: 'customers',
				db: databaseId
			};
			getItem(options, function (err, result) {
				if (err) return done(err);
				assert.isNotNull(result, 'Customer should be saved on DB');
				assert.equal(result._id, 'this-is-the-server-id', 'result._id should filled by the server');
				assert.equal(result.firstname, 'Michele', 'Should store the new firstname');
				assert.equal(result.lastname, 'Belluco', 'Should store the new lastname');

				var options = {
					storeName: 'dirty',
					db: 'dirty'
				};
				getItem(options, function (err, result) {
					if (err) return done(err);
					assert.isUndefined(result, 'Dirty store should be empty');
					done();
				});
			});
		};

		customer.save({
			firstname: 'Matteo',
			lastname: 'Baggio',
			company: 'ACME',
			cf: 'XXXX99999XXXX',
			vat: '01234567890',
			iban: 'IT011C010000000000000012234'
		}, {
			success: updateCustomer,
			error: done
		});
	});

	it('Should delete a customer', function (done) {
		Backbone.onlineSync = function (method, model, options) {
			options.success({
				_id: 'this-is-the-server-id'
			});
		};

		var customers = new Customers();
		var customer = new Customer();

		customers.add(customer);

		var deleteCustomer = function deleteCustomer(model) {
			customer.destroy({
				success: function() {
					assert.equal(customers.length, 0, 'No items in the customers collection');
					checkDirtyStore();
				},
				error: done
			});
		};

		var checkDirtyStore = function checkDirtyStore() {
			var options = {
				key: 'this-is-the-server-id',
				storeName: 'customers',
				db: databaseId
			};
			getItem(options, function (err, result) {
				if (err) return done(err);
				assert.isUndefined(result, 'Customer should be deleted');

				getItem({ storeName: 'dirty', db: 'dirty' }, function (err, result) {
					if (err) return done(err);
					assert.isUndefined(result, 'Dirty store should be empty');

					getItem({ storeName: 'destroyed', db: 'destroyed' }, function (err, result) {
						if (err) return done(err);
						assert.isUndefined(result, 'Destroyed store should be empty');
						done();
					});
				});
			});
		};

		customer.save({
			firstname: 'Matteo',
			lastname: 'Baggio',
			company: 'ACME',
			cf: 'XXXX99999XXXX',
			vat: '01234567890',
			iban: 'IT011C010000000000000012234'
		}, {
			success: deleteCustomer,
			error: done
		});
	});

	it('Should read a collection of customers', function (done) {
		Backbone.onlineSync = function (method, model, options) {
			var data = [
				{
					_id: 'this-is-the-server-id-A',
					firstname: 'Matteo',
					lastname: 'Baggio',
					company: 'ACME'
				},
				{
					_id: 'this-is-the-server-id-B',
					firstname: 'Michele',
					lastname: 'Belluco',
					company: 'ACME'
				}
			];
			options.success(data);
		};

		var checkCustomerB = function checkCustomerB() {
			var options = {
				key: 'this-is-the-server-id-B', 
				storeName: 'customers',
				db: databaseId
			};
			getItem(options, function (err, result) {
				if (err) return done(err);
				assert.equal(result.firstname, 'Michele');
				assert.equal(result.lastname, 'Belluco');
				done();
			});
		};

		var checkCustomerA = function checkCustomerA() {
			var options = {
				key: 'this-is-the-server-id-A', 
				storeName: 'customers',
				db: databaseId
			};
			getItem(options, function (err, result) {
				if (err) return done(err);
				assert.equal(result.firstname, 'Matteo');
				assert.equal(result.lastname, 'Baggio');
				checkCustomerB();
			});
		};

		var customers = new Customers();
		var options = {
			success: checkCustomerA,
			error: done
		};

		customers.fetch(options);
	});

	it('Should read a single customer', function (done) {
		Backbone.onlineSync = function (method, model, options) {
			var data = {
				_id: 'this-is-the-server-id',
				firstname: 'Matteo',
				lastname: 'Baggio',
				company: 'ACME'
			};
			options.success(data);
		};

		var customerA = new Customer({
			'_id': 'this-is-the-server-id'
		});

		customerA.fetch({
			success: function() {
				assert.equal(customerA.get('firstname'), 'Matteo');
				assert.equal(customerA.get('lastname'), 'Baggio');
				assert.equal(customerA.get('company'), 'ACME');
				done();
			},
			error: done
		});
	});

	it('Should sync dirty data', function (done) {

		var serverCustomerA = {
			_id: 'this-is-the-server-A',
			firstname: 'Matteo',
			lastname: 'Baggio',
			company: 'ACME'
		};
		var serverCustomerB = {
			_id: 'this-is-the-server-B',
			firstname: 'Michele',
			lastname: 'Belluco',
			company: 'ACME'
		};

		var serverDB = {
			byId: {
				'this-is-the-server-A': serverCustomerA,
				'this-is-the-server-B': serverCustomerB
			},
			models: [serverCustomerA, serverCustomerB]
		};

		Backbone.onlineSync = function (method, model, options) {
			if (!Backbone.DualStorage.isOnline) {
				var fakeResponse = {
					status: 502,
					response: 'Fake bad gateway'
				};
				return options.error(fakeResponse);
			}

			switch (method) {
				case 'read':
					return options.success(serverDB.models);
				case 'update':
					var response = _.extend(serverDB.byId[model.id], model.attributes);
					return options.success(response);
				case 'delete':
					delete serverDB.byId[model.id];
					serverDB.models = [];
					for (var aModelId in serverDB.byId) {
						var aModel = serverDB.byId[aModelId];
						serverDB.models.push(aModel);
					}
					return options.success();
			};
		};

		var customers = new Customers();

		var syncOnline = function syncOnline() {
			// Emulate online
			Backbone.DualStorage.isOnline = true;
			customers.syncDirtyAndDestroyed(function (err, response) {
				if (err) return done(err);
				var cA = serverDB.byId['this-is-the-server-A'];
				assert.equal(cA.firstname, 'Matteo');
				assert.equal(cA.lastname, 'Baggio');
				assert.equal(cA.company, 'New Co.');
				var cB = serverDB.byId['this-is-the-server-B'];
				assert.isUndefined(cB);
				done();
			});
		};

		var readOnline = function readOnline() {
			// Emulate online
			Backbone.DualStorage.isOnline = true;

			var newCustomers = new Customers();
			newCustomers.fetch({
				success: function () {
					assert.equal(newCustomers.get('this-is-the-server-A').get('company'), 'New Co.', 'Should read dirty data');
					syncOnline();
				},
				error: done
			});
		};

		var writeDirty = function writeDirty() {
			var customerA = customers.get('this-is-the-server-A');
			var customerB = customers.get('this-is-the-server-B');

			assert.isNotNull(customerA);
			assert.equal(customerA.get('firstname'), 'Matteo');
			assert.isNotNull(customerB);

			// Emulate offline
			Backbone.DualStorage.isOnline = false;

			// Edit customer A
			customerA.save({ 
				'company': 'New Co.'
			}, {
				success: function (model) {
					assert.equal(model.get('company'), 'New Co.');

					var options = {
						db: databaseId, 
						storeName: 'customers',
						key: 'this-is-the-server-A'
					};
					getItem(options, function (err, result) {
						if (err) return done(err);
						assert.equal(result.company, 'New Co.');
						// Delete customer B
						customerB.destroy({
							success: readOnline,
							error: done
						});
					});
				},
				error: done
			});
		};

		customers.fetch({
			success: writeDirty,
			error: done
		});
	});

});
