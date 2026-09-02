package com.inknow.manusim.view;

import com.inknow.manusim.control.Const;

/** Device is the object representing a generalization of an energy consuming device. 
*
* @author Rui Neves-Silva (UNINOVA - FCT/UNL)
* @version 1.0 Build 0001 Nov-2011/Feb-2013.
*/

@SuppressWarnings("serial")
public class UnitLabel extends javax.swing.JLabel {
	
	private int id;
	private int type;
	private int status;
	private int workareaId;
	private Image onImage;
	private Image offImage;
	
	// constructors
	
	public UnitLabel() {
		super();

		this.id = -1;
		this.type = -1;
		this.status = Const.STATUS_ON;
		this.workareaId = -1;
		this.onImage = new Image();
		this.offImage = new Image();
	}
	
	public UnitLabel(int id, int type, int status, int workareaId) {
		this.id = id;
		this.type = type;
		this.status = Const.STATUS_ON;
		this.workareaId = workareaId;
		//
		switch(this.type){
		case Const.UNIT_A1:
			this.onImage = new Image(Const.UNIT_A1_ON_FILENAME);
			this.offImage = new Image(Const.UNIT_A1_OFF_FILENAME);
			break;
		case Const.UNIT_A2:
			this.onImage = new Image(Const.UNIT_A2_ON_FILENAME);
			this.offImage = new Image(Const.UNIT_A2_OFF_FILENAME);
			break;
		case Const.UNIT_A3:
			this.onImage = new Image(Const.UNIT_A3_ON_FILENAME);
			this.offImage = new Image(Const.UNIT_A3_OFF_FILENAME);
			break;
		case Const.UNIT_B1:
			this.onImage = new Image(Const.UNIT_B1_ON_FILENAME);
			this.offImage = new Image(Const.UNIT_B1_OFF_FILENAME);
			break;
		case Const.UNIT_B2:
			this.onImage = new Image(Const.UNIT_B2_ON_FILENAME);
			this.offImage = new Image(Const.UNIT_B2_OFF_FILENAME);
			break;
		case Const.UNIT_B3:
			this.onImage = new Image(Const.UNIT_B3_ON_FILENAME);
			this.offImage = new Image(Const.UNIT_B3_OFF_FILENAME);
			break;
		case Const.UNIT_C1:
			this.onImage = new Image(Const.UNIT_C1_ON_FILENAME);
			this.offImage = new Image(Const.UNIT_C1_OFF_FILENAME);
			break;
		case Const.UNIT_C2:
			this.onImage = new Image(Const.UNIT_C2_ON_FILENAME);
			this.offImage = new Image(Const.UNIT_C2_OFF_FILENAME);
			break;
		case Const.UNIT_C3:
			this.onImage = new Image(Const.UNIT_C3_ON_FILENAME);
			this.offImage = new Image(Const.UNIT_C3_OFF_FILENAME);
			break;
		default:
			this.onImage = new Image();
			this.offImage = new Image();
		}
	}
	
	// other methods
	
	public void showUnit() {	
		if (this.status == Const.STATUS_ON) {
			this.setIcon( new javax.swing.ImageIcon( this.onImage.getFileName() ) );
			this.setSize( this.onImage.getWidth(), this.onImage.getHeight());
		} else {
			this.setIcon( new javax.swing.ImageIcon( this.offImage.getFileName() ) );
			this.setSize( this.offImage.getWidth(), this.offImage.getHeight());
		}
		int unitMasterType = ( this.type / 10 );
		switch(unitMasterType) {
		  case Const.UNIT_A:
			  this.setLocation(Const.UNIT_A_WA_X, Const.UNIT_A_WA_Y);
			  break;
		  case Const.UNIT_B:
			  this.setLocation(Const.UNIT_B_WA_X, Const.UNIT_B_WA_Y);
			  break;
		  case Const.UNIT_C:
			  this.setLocation(Const.UNIT_C_WA_X, Const.UNIT_C_WA_Y);
			  break;
		  default:
		}
		return;
	}
	
	
	// gets & sets
	
	public int getId() {
		return this.id;
	}

	public int getType() {
		return this.type;
	}
	
	public String getTypeString() {
		switch(this.type){
		case Const.UNIT_A1:
			return "A1";
		case Const.UNIT_A2:
			return "A2";
		case Const.UNIT_A3:
			return "A3";
		case Const.UNIT_B1:
			return "B1";
		case Const.UNIT_B2:
			return "B2";
		case Const.UNIT_B3:
			return "B3";
		case Const.UNIT_C1:
			return "C1";
		case Const.UNIT_C2:
			return "C2";
		case Const.UNIT_C3:
			return "C3";
		default:
			return "";	
		}
	}
	
	public int getStatus() {
		return this.status;
	}

	public int getWorkareaId() {
		return this.workareaId;
	}
	
	// --

	public void setId(int id) {
		this.id = id;
		return;
	}

	public void setType(int type) {
		this.type = type;
		return;
	}
	
	public void setStatus(int status) {
		this.status = status;
		return;
	}

	public void setWorkareaId(int workareaId) {
		this.workareaId = workareaId;
		return;
	}
	
} // EOF
