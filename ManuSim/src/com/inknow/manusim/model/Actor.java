package com.inknow.manusim.model;

import com.inknow.manusim.control.Const;

/** Actor is the object representing the plant operator
*
* @author Rui Neves-Silva
* @version 2.0 Build 0002 Oct-2019.
*/

public class Actor {
	
	// parameters
	private int id;
	private String name;
	private int type;
	// state
	private int status;
	private int locationIndex;
	private Expertise expertise;
	
	// constructors
	
	public Actor(){
		this.id = 0;
		this.name = "";
		this.type = -1;
		this.status = Const.STATUS_ON;
		this.locationIndex = -1;
		this.expertise = new Expertise();
	}
	
	public Actor(int id, String name, int workLocationIndex){
		this.id = id;
		this.name = name;		
		this.locationIndex = workLocationIndex;
		switch (this.name.charAt(0)) {
		case 'A':
			this.type = Const.ACTOR_TYPE_A;
			break;
		case 'B':
			this.type = Const.ACTOR_TYPE_B;
			break;
		case 'C':
			this.type = Const.ACTOR_TYPE_C;
			break;
		case 'D':
			this.type = Const.ACTOR_TYPE_D;
			break;
		default:
			this.type = Const.ACTOR_TYPE_A;
			break;
		}
		this.status = Const.STATUS_ON;
	}
	
	// other methods
	
	public void simulateStep(){
		this.status = Const.STATUS_ON;
		this.locationIndex++;
		this.locationIndex = (this.locationIndex == Const.N_LOCATIONS ? 0 : this.locationIndex);
		return;
	}
			
	// gets & sets
	
	public int getId() {
		return this.id;
	}
	
	public String getName() {
		return this.name;
	}

	public int getType() {
		return this.type;
	}
	
	public int getStatus() {
		return status;
	}
		
	public int getLocationIndex() {
		return this.locationIndex;
	}
	
	public Expertise getExpertise() {
		return this.expertise;
	}
			
	//--

	public void setId(int id) {
		this.id = id;
		return;
	}
	
	public void setName(String name) {
		this.name = name;
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

	public void setLocationIndex(int workLocationIndex) {
		this.locationIndex = workLocationIndex;
		return;
	}
	
	public void setExpertise(Expertise expertise) {
		this.expertise = expertise;
		return;
	}
	
} // EOF
