import { wait } from '../util/helpers'
import pom from '../page-objects/index'

export const people = {
  invite(driver) {
    it('opens the People tab', async () => {
      await wait.andClick(driver, pom.navigation.sections.people)
    })

    it('clicks on the + button to Invite a User', async () => {
      await wait.andClick(driver, pom.people.add)
    })

    it('views the invitation link', async () => {
      // Store Invite
      global.e2e.joinUrl = await wait.andGetValue(driver, pom.people.invite.joinUrl)
      // OK
      await wait.andClick(driver, pom.people.invite.ok)
    })
  },
  editUser(driver, user) {
    it('opens the People tab', async () => {
      await wait.andClick(driver, pom.navigation.sections.people)
    })

    it('clicks on the Edit button next to name', async () => {
      const userRow = await wait.andGetEl(driver, pom.people.getRowByName(user.given_name))
      const editButton = await userRow.findElement(pom.people.edit.editButton)
      await editButton.click()
    })

    it('changes user details', async () => {
      await wait.andType(driver, pom.people.edit.firstName, user.given_name_changed, { click: true, clear: false })
      await wait.andType(driver, pom.people.edit.lastName, user.family_name_changed, { click: true, clear: false })
      await wait.andType(driver, pom.people.edit.email, user.email_changed, { click: true, clear: false })
      await wait.andType(driver, pom.people.edit.cell, user.cell_changed, { click: true, clear: false })
      // Save
      await wait.andClick(driver, pom.people.edit.save)
      await driver.sleep(3000)
      // Verify edits
      expect(await wait.andGetEl(driver, pom.people.getRowByName(user.given_name_changed))).toBeDefined()
    })

    it('clicks on the Edit button next to name', async () => {
      const userRow = await wait.andGetEl(driver, pom.people.getRowByName(user.given_name_changed))
      const editButton = await userRow.findElement(pom.people.edit.editButton)
      await editButton.click()
    })

    it('reverts user details back to original settings', async () => {
      await wait.andType(driver, pom.people.edit.firstName, user.given_name, { click: true, clear: false })
      await wait.andType(driver, pom.people.edit.lastName, user.family_name, { click: true, clear: false })
      await wait.andType(driver, pom.people.edit.email, user.email, { click: true, clear: false })
      await wait.andType(driver, pom.people.edit.cell, user.cell, { click: true, clear: false })
      // Save
      await wait.andClick(driver, pom.people.edit.save)
      await driver.sleep(3000)
      // Verify edits
      expect(await wait.andGetEl(driver, pom.people.getRowByName(user.given_name))).toBeDefined()
    })
  }
}
