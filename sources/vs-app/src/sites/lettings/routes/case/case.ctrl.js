const {propertyAdminFunctions, initForSale} = require('../../../../services/property-admin-functions.js');
(function() {
  'use strict';
  angular.module('vs-lettings-inner').controller('lettingsCaseCtrl', function($scope, $stateParams, $state, $timeout, $window, $http, Auth, LettingsProgressionPopup, lettingsProperty, Upload, env, alert, breadcrumbs) {
    let fetchedFirst = false;
    $scope.side = 'LETTING';
    propertyAdminFunctions($scope, alert);
    $scope.propsOpts = {
      where: {
        RoleStatus: 'OfferAccepted',
        RoleType: 'Letting',
        IncludeStc: true
      },
      transform: {
        items: 'Collection',
        total: 'TotalCount'
      }
    };
    $scope.clockStarted = false;
    $scope.properties = $scope.list({
      route: `${env.PROPERTY_URL}/search`
    }, $scope.propsOpts, function(properties) {
      var i, len, property, ref1, results;
      ref1 = properties.items;
      results = [];
      for (i = 0, len = ref1.length; i < len; i++) {
        property = ref1[i];
        results.push(property.displayAddress = `${property.Address.Number} ${property.Address.Street}, ${property.Address.Locality}, ${property.Address.Town}, ${property.Address.Postcode}`);
      }
      return results;
    });
    $scope.notesLimit = 10;
    $scope.notesPage = 1;
    $scope.property = $scope.single({
      route: `${env.PROPERTY_URL}/property`
    }, $stateParams.roleId, function(res) {
      var property;
      let adminFetched = false;
      property = res.item;
      console.log('Property object:', property);
      console.log('Looking for Fees:', property.Fees);
      property.displayAddress = `${property.Address.Number} ${property.Address.Street}, ${property.Address.Locality}, ${property.Address.Town}, ${property.Address.Postcode}`;
      breadcrumbs.setInfo(property.displayAddress);
      if(!fetchedFirst) {
        $scope.propertyadmin = $scope.single('main:propertyadmin', { RoleId: +property.RoleId }, (propertyadmin) => {
          if(!adminFetched) {
            initForSale(propertyadmin, property, $scope.auth.getUser());
          }
          adminFetched = true;
          return propertyadmin;
        });
      }
      fetchedFirst = true;
      const availableDate = new Date(property.AvailableDate);
      let availableDateVal = availableDate.valueOf() - (availableDate.getTimezoneOffset() * 60 * 1000);
      property.$case = $scope.single('lettings:properties', property.RoleId + '_' + availableDateVal, function(item) {
        var branch, i, len, milestone, progression, ref1, results, timeLeft;
        item.parent.search = `${item.parent.displayAddress}||${item.vendor}||${item.purchaser}`;
        item.item.proposedMoving = new Date(item.item.proposedMoving);
        
        // Generate icon from title if not present
        if (item.item.milestone && !item.item.milestone.icon && item.item.milestone.title) {
          item.item.milestone.icon = item.item.milestone.title.toLowerCase()
            .replace(/&/g, 'and')
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-');
        }
        
        ref1 = property.$case.item.progressions;
        results = [];
        for (i = 0, len = ref1.length; i < len; i++) {
          progression = ref1[i];
          results.push((function() {
            var j, len1, ref2, results1;
            ref2 = progression.milestones;
            results1 = [];
            for (j = 0, len1 = ref2.length; j < len1; j++) {
              branch = ref2[j];
              results1.push((function() {
                var k, len2, results2;
                results2 = [];
                for (k = 0, len2 = branch.length; k < len2; k++) {
                  milestone = branch[k];
                  if (milestone.title.toLowerCase() === 'holding deposit') {
                    if (milestone.completed) {
                      timeLeft = (milestone.completedTime + (15 * 24 * 60 * 60 * 1000) - new Date().valueOf()) / 1000;
                      $scope.showClock = true;
                      if (timeLeft > 0) {
                        $scope.setTime(timeLeft);
                        $scope.setCountdown(true);
                      } else {
                        $scope.setTime(-timeLeft);
                        $scope.setCountdown(false);
                      }
                      if (!$scope.clockStarted) {
                        $scope.start();
                      }
                      results2.push($scope.clockStarted = true);
                    } else {
                      results2.push(void 0);
                    }
                  } else if (milestone.title.toLowerCase() === 'rental complete') {
                    if (milestone.completed) {
                      $scope.showClock = false;
                      if ($scope.clockStarted) {
                        $scope.clockStarted = false;
                        results2.push($scope.stop());
                      } else {
                        results2.push(void 0);
                      }
                    } else {
                      results2.push(void 0);
                    }
                  } else {
                    results2.push(void 0);
                  }
                }
                return results2;
              })());
            }
            return results1;
          })());
        }
        return results;
      });
      property.$case.parent = property;
      return lettingsProperty.set(property);
    });
    $scope.boardsList = $scope.list('main:boards');
    $scope.progressions = $scope.list('lettings:progressions', {
      sort: 'i'
    });
    $scope.stopCallback = function() {
      return $timeout(function() {
        if ($scope.getTime().time === 0) {
          $scope.depositOverdue = true;
          $scope.setCountdown(false);
          return $scope.start();
        }
      });
    };
    $scope.config = {
      prefix: 'swiper',
      modifier: 1.5,
      show: false
    };
    $scope.date = {
      date: 'today'
    };
    $scope.relist = () => {
      $scope.property.item.$case.item.delisted = false;
      $scope.property.item.$case.save();
    }
    $scope.calculateFirstRent = () => {
      try {
        $scope.property.item.$case.item.firstRentalPayment = (Math.round((Math.max(0, +$scope.property.item.$case.item.agreedRent - +$scope.property.item.$case.item.hDeposit) + Number.EPSILON) * 100) / 100).toFixed(2);
      }
      catch (e) {

      }
    }
    $scope.submitRT = function() {
      if ($scope.rentalTerms.$valid) {
        $scope.rentalTerms.$setPristine();
        return $scope.property.item.$case.save().then(function() {
          return alert.log('Rental terms saved');
        }, function() {
          return alert.error('Error saving rental terms');
        });
      }
    };
    $scope.addNote = function() {
      var i, j, len, len1, mynote, progression, property, ref1, ref2, updateProgressionNotes;
      if ($scope.note) {
        property = $scope.property.item;
        if (property && property.$case && property.$case.item) {
          if ($scope.note.date) {
            updateProgressionNotes = function(milestones, note) {
              var branch, i, len, milestone, mynote, results;
              results = [];
              for (i = 0, len = milestones.length; i < len; i++) {
                branch = milestones[i];
                results.push((function() {
                  var j, len1, results1;
                  results1 = [];
                  for (j = 0, len1 = branch.length; j < len1; j++) {
                    milestone = branch[j];
                    if (milestone.notes && milestone.notes.length) {
                      results1.push((function() {
                        var k, len2, ref1, results2;
                        ref1 = milestone.notes;
                        results2 = [];
                        for (k = 0, len2 = ref1.length; k < len2; k++) {
                          mynote = ref1[k];
                          if (mynote.date === note.date && mynote.item === note.item && mynote.side === note.side) {
                            mynote.text = note.text;
                            mynote.updatedAt = new Date();
                            results2.push(mynote.updatedBy = Auth.getUser());
                          } else {
                            results2.push(void 0);
                          }
                        }
                        return results2;
                      })());
                    } else {
                      results1.push(void 0);
                    }
                  }
                  return results1;
                })());
              }
              return results;
            };
            if (property.$case.item.notes) {
              ref1 = property.$case.item.notes;
              for (i = 0, len = ref1.length; i < len; i++) {
                mynote = ref1[i];
                if (mynote.date === $scope.note.date && mynote.item === $scope.note.item && mynote.side === $scope.note.side) {
                  mynote.text = $scope.note.text;
                  mynote.updatedAt = new Date();
                  mynote.updatedBy = Auth.getUser();
                }
              }
            }
            ref2 = property.$case.item.progressions;
            for (j = 0, len1 = ref2.length; j < len1; j++) {
              progression = ref2[j];
              updateProgressionNotes(progression.milestones, $scope.note);
            }
          } else {
            property.$case.item.notes.push({
              date: new Date(),
              text: $scope.note.text,
              item: 'Case Note',
              side: '',
              user: Auth.getUser()
            });
          }
          property.$case.save();
          alert.log('Note added');
          return $scope.note = null;
        }
      }
    };
    $scope.editNote = function(note) {
      $scope.note = JSON.parse(JSON.stringify(note));
      return $('.add-note')[0].scrollIntoView(true);
    };
    $scope.deleteNote = function(note) {
      var deleteProgressionNotes, i, j, len, len1, mynote, progression, property, ref1, ref2;
      property = $scope.property.item;
      deleteProgressionNotes = function(milestones, note) {
        var branch, i, j, k, len, len1, len2, milestone, mynote, ref1;
        for (i = 0, len = milestones.length; i < len; i++) {
          branch = milestones[i];
          for (j = 0, len1 = branch.length; j < len1; j++) {
            milestone = branch[j];
            if (milestone.notes && milestone.notes.length) {
              ref1 = milestone.notes;
              for (k = 0, len2 = ref1.length; k < len2; k++) {
                mynote = ref1[k];
                if (mynote.date === note.date && mynote.item === note.item && mynote.side === note.side) {
                  return milestone.notes.remove(mynote);
                }
              }
            }
          }
        }
      };
      if (property.$case.item.notes) {
        ref1 = property.$case.item.notes;
        for (i = 0, len = ref1.length; i < len; i++) {
          mynote = ref1[i];
          if (mynote.date === note.date && mynote.item === note.item && mynote.side === note.side) {
            property.$case.item.notes.remove(mynote);
            break;
          }
        }
      }
      ref2 = property.$case.item.progressions;
      for (j = 0, len1 = ref2.length; j < len1; j++) {
        progression = ref2[j];
        deleteProgressionNotes(progression.milestones, note);
      }
      property.$case.save();
      alert.log('Note deleted');
      return $scope.note = null;
    };
    $scope.getNotes = function() {
      var fetchProgressionNotes, i, j, k, len, len1, len2, note, notes, progression, property, ref1, ref2, ref3;
      property = $scope.property.item;
      if (property && property.$case && property.$case.item) {
        notes = [];
        fetchProgressionNotes = function(milestones) {
          var branch, i, len, milestone, note, results;
          results = [];
          for (i = 0, len = milestones.length; i < len; i++) {
            branch = milestones[i];
            results.push((function() {
              var j, len1, results1;
              results1 = [];
              for (j = 0, len1 = branch.length; j < len1; j++) {
                milestone = branch[j];
                if (milestone.notes && milestone.notes.length) {
                  results1.push((function() {
                    var k, len2, ref1, results2;
                    ref1 = milestone.notes;
                    results2 = [];
                    for (k = 0, len2 = ref1.length; k < len2; k++) {
                      note = ref1[k];
                      results2.push(notes.push(note));
                    }
                    return results2;
                  })());
                } else {
                  results1.push(void 0);
                }
              }
              return results1;
            })());
          }
          return results;
        };
        ref1 = property.$case.item.progressions;
        for (i = 0, len = ref1.length; i < len; i++) {
          progression = ref1[i];
          fetchProgressionNotes(progression.milestones);
        }
        if (property.$case.item.notes && property.$case.item.notes.length) {
          ref2 = property.$case.item.notes;
          for (j = 0, len1 = ref2.length; j < len1; j++) {
            note = ref2[j];
            notes.push(note);
          }
        }
        if ($scope.auth.checkRoles(['superadmin', 'admin'])) {
          if (property.$case.item.advanceRequests && property.$case.item.advanceRequests.length) {
            ref3 = property.$case.item.advanceRequests;
            for (k = 0, len2 = ref3.length; k < len2; k++) {
              note = ref3[k];
              notes.push(note);
            }
          }
        }
        return notes;
      }
    };
    $scope.addProgression = function(progression) {
      var property;
      property = $scope.property.item;
      if (property && property.$case && property.$case.item) {
        if (!property.$case.item.progressions) {
          property.$case.item.progressions = [];
        }
        property.$case.item.progressions.push(JSON.parse(JSON.stringify(progression)));
        return property.$case.save();
      }
    };
    $scope.addChain = function(chain, side) {
      var index;
      index = 0;
      if (side === 'seller') {
        index = $scope.property.item.$case.item.chainSeller.length;
      }
      chain.push({
        note: '',
        reference: '',
        side: side
      });
      return $scope.chainEdit = side + index;
    };
    $scope.editChain = function(side, index) {
      return $scope.chainEdit = side + index;
    };
    $scope.saveChain = function(item) {
      var i, len, prop, ref1;
      if (item.property) {
        ref1 = $scope.properties.items;
        for (i = 0, len = ref1.length; i < len; i++) {
          prop = ref1[i];
          if (prop.RoleId === +item.property) {
            item.propDetails = objtrans(prop, {
              id: true,
              address: function(property) {
                return `${property.Address.Number} ${property.Address.Street}, ${property.Address.Locality}, ${property.Address.Town}`;
              },
              image: 'Images[0].Url',
              price: 'Price.PriceValue'
            });
          }
        }
      }
      $scope.chainEdit = null;
      $scope.property.item.$case.save();
      return alert.log('Chain saved');
    };
    $scope.deleteChainItem = function(item, side) {
      var chain;
      chain = side === 'buyer' ? $scope.property.item.$case.item.chainBuyer : $scope.property.item.$case.item.chainSeller;
      chain.remove(item);
      return $scope.saveChain();
    };
    $scope.uploadFiles = function(files, errFiles) {
      var mycase;
      mycase = $scope.property.item.$case;
      if (files) {
        $scope.uploadProgress = 0;
        $scope.documentUploading = true;
        return Upload.upload({
          url: $http.sites["lettings"].url + '/api/upload',
          data: {
            file: files,
            user: Auth.getUser()
          },
          headers: $http.sites["lettings"].config.headers
        }, $http.sites["lettings"].config).then(function(response) {
          var document, i, len, ref1;
          $scope.documentUploading = false;
          if (response.data) {
            $scope.uploadProgress = 0;
            if (!mycase.item.documents) {
              mycase.item.documents = [];
            }
            ref1 = response.data;
            for (i = 0, len = ref1.length; i < len; i++) {
              document = ref1[i];
              mycase.item.documents.push(document);
            }
            alert.log('Document uploaded');
            return mycase.save();
          }
        }, function(err) {
          $scope.documentUploading = false;
          return false;
        }, function(progress) {
          return $scope.uploadProgress = Math.min(100, parseInt(100.0 * progress.loaded / progress.total));
        });
      }
    };
    $scope.saveDocument = function(document) {
      document.editing = false;
      alert.log('Document updated');
      return $scope.property.item.$case.save();
    };
    $scope.deleteDocument = function(document) {
      if ($window.confirm('Are you sure you want to delete this document?')) {
        $scope.property.item.$case.item.documents.splice($scope.property.item.$case.item.documents.indexOf(document), 1);
        alert.log('Document deleted');
        return $scope.property.item.$case.save();
      }
    };
    $scope.hideDropdown = function(dropdown) {
      return $timeout(function() {
        return $scope[dropdown] = false;
      }, 200);
    };
    $scope.advanceProgression = function() {
      return $scope.modal({
        template: require('../../modals/advance-progression/advance-progression.html').default,
        controller: 'lettingsAdvanceProgressionCtrl',
        data: {
          property: objtrans($scope.property.item, {
            roleId: 'RoleId',
            displayAddress: true,
            advanceRequests: '$case.item.advanceRequests',
            progressions: '$case.item.progressions'
          })
        }
      }, $http.sites["lettings"].config).then(function() {
        return alert.log('Request submitted');
      }, function() {
        return false;
      });
    };
    $scope.applyRequest = function(request) {
      var advMilestone, advanceTo, branch, i, j, k, l, len, len1, len2, len3, milestone, progression, ref1, ref2, ref3;
      ref1 = $scope.property.item.$case.item.progressions;
      for (i = 0, len = ref1.length; i < len; i++) {
        progression = ref1[i];
        ref2 = progression.milestones;
        for (j = 0, len1 = ref2.length; j < len1; j++) {
          branch = ref2[j];
          for (k = 0, len2 = branch.length; k < len2; k++) {
            milestone = branch[k];
            advanceTo = new Date(request.advanceTo);
            ref3 = request.milestones;
            for (l = 0, len3 = ref3.length; l < len3; l++) {
              advMilestone = ref3[l];
              if (milestone._id === advMilestone._id) {
                milestone.userCompletedTime = advanceTo.valueOf();
              }
            }
          }
        }
      }
      request.applied = true;
      return $scope.property.item.$case.save();
    };
    $scope.requestEmail = function(to) {
      var data, name, ref1, ref2;
      name = function(ref) {
        return ref.FirstName + ' ' + ref.LastName;
      };
      data = {
        type: to,
        property: $scope.property.item.$case.item
      };
      if (to === 'Landlord') {
        data.toName = name($scope.property.item.$case.item.Landlord);
        data.toMail = (ref1 = $scope.property.item.$case.item.Landlord.PrimaryEmail) != null ? ref1.Value : void 0;
        data.refName = name($scope.property.item.$case.item.Tenants[0].Person);
      } else {
        data.toName = name($scope.property.item.$case.item.Tenants[0].Person);
        data.toMail = (ref2 = $scope.property.item.$case.item.Tenants[0].Person.PrimaryEmail) != null ? ref2.Value : void 0;
        data.refName = name($scope.property.item.$case.item.Landlord);
      }
      return $scope.modal({
        template: require('../../modals/request-email/request-email.html').default,
        controller: 'lettingsRequestEmailCtrl',
        data: data
      }, $http.sites["lettings"].config).then(function() {}, function() {});
    };
    $scope.fallenThrough = function() {
      if (window.confirm('Are you sure you want to flag this property as Fallen through?')) {
        $scope.property.item.$case.item.override = $scope.property.item.$case.override || {};
        $scope.property.item.$case.item.override.deleted = true;
        $scope.property.item.$case.item.override.reason = 'fallenThrough';
        $scope.property.item.$case.save();
        return $state.go('cases');
      }
    };
    return $scope.$on('$destroy', function() {
      return LettingsProgressionPopup.hide();
    });
  });

}).call(this);
