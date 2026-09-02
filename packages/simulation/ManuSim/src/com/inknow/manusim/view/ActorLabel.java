package com.inknow.manusim.view;

import com.inknow.manusim.control.Const;

/** ActorLabel is the object representing the IMAGE of plant operator in VIEW
*
* @author Rui Neves-Silva
* @version 2.0 Build 0002 Oct-2019
*/

@SuppressWarnings("serial")
public class ActorLabel extends javax.swing.JLabel {
	
	private int id;
	private String name;
	private Image workImage;
	//
	private Location workLocation;
	
	// constructors
	
	public ActorLabel(){
		super();
		this.id = 0;
		this.name = "";
		this.workImage = new Image();
		//
		this.workLocation = new Location();
	}

	public ActorLabel(int id, String name){
		super();
		this.id = id;
		this.name = name;
		String fileImageWork = Const.ACTOR_PREFIX_FILENAME + this.name + Const.ACTOR_SUFFIX_FILENAME;
		this.workImage = new Image(fileImageWork);	
		//
		this.workLocation = new Location();
	}
	
	// other methods
		
	public void goToWorkarea(Location location, int status) {
		this.workLocation = location;
		if ( this.workLocation.getId() != 0 && status != Const.STATUS_ACCIDENT ) {
			this.setIcon( new javax.swing.ImageIcon( this.workImage.getFileName() ) );
			this.setLocation(this.workLocation.getxWorkarea(), this.workLocation.getyWorkarea());
			this.setSize( this.workImage.getWidth(), this.workImage.getHeight());
			this.workLocation.getWorkareaPane().add(this,0);
		} else {
			this.setIcon(new javax.swing.ImageIcon());
			this.setLocation(0,0);
			this.setSize(0,0);
		}
		return;
	}
		
	// gets & sets

	public int getId() {
		return this.id;
	}

	@Override
	public String getName() {
		return this.name;
	}

	public Location getWorkLocation() {
		return this.workLocation;
	}

	public Image getWorkImage() {
		return this.workImage;
	}

	//--

	public void setId(int id) {
		this.id = id;
		return;
	}
	
	@Override
	public void setName(String name) {
		this.name = name;
		return;
	}

	public void setWorkLocation(Location workLocation) {
		this.workLocation = workLocation;
		return;
	}
	
	public void setWorkImage(Image workImage) {
		this.workImage = workImage;
		return;
	}

} // EOF
