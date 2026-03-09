'use strict'

module.exports = (ndx) ->
  ndx.app.get '/offerpdf/:id', (req, res, next) ->
    applicationId = req.params.id
    formData = await ndx.database.selectOne 'offerslettings',
      uid: applicationId
    if !formData
      return res.status(404).send('Application not found')
    doc = new PDFDocument
    res.setHeader 'Content-Type', 'application/pdf'
    res.setHeader 'Content-Disposition', 'attachment; filename="application_' + applicationId + '.pdf"'
    doc.pipe res
    doc.fontSize(18).text 'New Tenancy Application', align: 'center'
    doc.moveDown()

    addSection = (title, fields) ->
      doc.fontSize(14).text title, underline: true
      doc.moveDown 0.5
      Object.entries(fields).forEach (key, value) ->
        doc.fontSize(11).text key.replace(/_/g, ' ') + ':' + value or '-'
        return
      doc.moveDown()
      return

    addSection 'Property',
      Address: formData.address
      RoleId: formData.roleId

    addSection 'Applicant Details',
      Name: formData.applicant.title + ' ' + formData.applicant.first_name + ' ' + formData.applicant.last_name
      Phone: formData.applicant.phone_day
      DOB: formData.applicant.dob
      Email: formData.email

    if formData.applicant2.first_name
      addSection 'Applicant 2 Details',
        Name: formData.applicant2.title + ' ' + formData.applicant2.first_name + ' ' + formData.applicant2.last_name

    addSection 'Employment Information', formData.employment
    addSection 'Preferences', formData.preferences
    addSection 'Rent Details', formData.rent_details
    doc.fontSize(11).text if 'Consent Given: ' + formData.consent then 'Yes' else 'No'
    doc.end()
    return