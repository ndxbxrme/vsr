const {propertyAdminFunctions, initForSale} = require('../../../../services/property-admin-functions.js');
(function () {
  'use strict';
  angular.module('vs-agency').controller('agencyOfferCtrl', function ($scope, $sce, $stateParams, $state, $timeout, $interval, $http, $window, Auth, AgencyProgressionPopup, agencyProperty, Upload, env, alert) {
    $scope.activeTab = 'details';
    $scope.offer = $scope.single('leads:offers', $stateParams.id, async (offer) => {
      offer.date = new Date(offer.date);
      offer.item.date = new Date(offer.item.date);
      offer.item.search = `${offer.address}:${offer.applicant}:${offer.applicant2 || ''}`;
      
      // Resize image URL to 590x400 and handle WordPress version numbers
      if(offer.item.image) {
        const originalImage = offer.item.image;
        offer.item.image = offer.item.image.replace(/-\d+x\d+\./, '-590x400.');
        const versionMatch = offer.item.image.match(/^(.+\/)(\d{8})-(\d+)(-590x400\.[^/]+)$/);
        if(versionMatch) {
          offer.item.image = `${versionMatch[1]}${versionMatch[2]}${versionMatch[4]}`;
          offer.item.imageFallback1 = `${versionMatch[1]}${versionMatch[2]}-1${versionMatch[4]}`;
          offer.item.imageFallback2 = `${versionMatch[1]}${versionMatch[2]}-${versionMatch[3]}${versionMatch[4]}`;
        } else {
          const noVersionMatch = offer.item.image.match(/^(.+\/)(.+)(-590x400)(\.[^/]+)$/);
          if(noVersionMatch) {
            offer.item.imageFallback1 = `${noVersionMatch[1]}${noVersionMatch[2]}${noVersionMatch[4]}`;
          }
        }
      }
      
      const data = await $http({
        method: 'GET',
        url: 'https://server.vitalspace.co.uk/dezrez/role/' + offer.item.roleId
      });
      $timeout(() => {
        offer.item.$case = data;
      })
    });
    $scope.getUpload = (key) => {
      if(!$scope.offer.item || !$scope.offer.item.uploads) return '';
      const upload = $scope.offer.item.uploads.find(upload => upload.key===key);
      if(!upload) return '';
      const type = (upload.file.match(/\.([^.]+)$/) || [])[0];
      if(type==='.pdf')
        return $sce.trustAsHtml(`<a href="${upload.file}" target="_blank" class="offer-upload pdf-upload"><i class="fa-regular fa-file-pdf"></i> <span>View</span></a>`)
      return $sce.trustAsHtml(`<a href="${upload.file}" target="_blank" class="offer-upload jpg-upload"><i class="fa-regular fa-file-jpg"></i> <span>View</span</a>`);
    };
    $scope.addNote = function() {
      var i, len, mynote, ref;
      if ($scope.note) {
        const offer = $scope.offer.item;
        if (offer) {
          if ($scope.note.date) {
            if (offer.notes) {
              ref = offer.notes;
              for (i = 0, len = ref.length; i < len; i++) {
                mynote = ref[i];
                if (mynote.date === $scope.note.date && mynote.item === $scope.note.item && mynote.side === $scope.note.side) {
                  mynote.text = $scope.note.text;
                  mynote.updatedAt = new Date();
                  mynote.updatedBy = Auth.getUser();
                }
              }
            }
          } else {
            offer.notes = offer.notes || [];
            offer.notes.push({
              date: new Date(),
              text: $scope.note.text,
              item: 'Offer Note',
              side: '',
              user: Auth.getUser()
            });
          }
          $scope.offer.save();
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
      var i, len, mynote, ref;
      const offer = $scope.offer.item;
      if (offer.notes) {
        ref = offer.notes;
        for (i = 0, len = ref.length; i < len; i++) {
          mynote = ref[i];
          if (mynote.date === note.date && mynote.item === note.item && mynote.side === note.side) {
            offer.notes.remove(mynote);
            break;
          }
        }
      }
      $scope.offer.save();
      alert.log('Note deleted');
      return $scope.note = null;
    };
    $scope.getNotes = function() {
      var j, len1, note, notes, ref1;
      const offer = $scope.offer.item;
      if (offer) {
        notes = [];
        if (offer.notes && offer.notes.length) {
          ref1 = offer.notes;
          for (j = 0, len1 = ref1.length; j < len1; j++) {
            note = ref1[j];
            notes.push(note);
          }
        }
        return notes;
      }
    };
    $scope.actionOffer = function(offer) {
      offer.item.actioned = new Date();
      offer.save();
      alert.log('Offer actioned');
      $state.go('agency_offers-list');
    }
    $scope.formatAddress = (address) => {
      if(!address) return '';
      return address.replace(/, ,/g, ',');
    }
  });

}).call(this);
